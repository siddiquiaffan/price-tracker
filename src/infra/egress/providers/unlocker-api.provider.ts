import {
  EgressRequestError,
  type EgressCapabilities,
  type EgressProvider,
  type EgressRequest,
  type EgressRequestOptions,
  type EgressResponse,
} from '../egress-provider.interface.js';
import { DEFAULT_REQUEST_TIMEOUT_MS } from './direct.provider.js';
import {
  errorMessage,
  performUndiciRequest,
  type RawRequestInput,
  type RawResponse,
} from './http-util.js';

export interface UnlockerApiProviderOptions {
  id: string;
  url: string;
  weight?: number;
  capabilities?: EgressCapabilities;
  timeoutMs?: number;
  /** 'GET' (target URL as a query param) or 'POST' (JSON body). */
  method?: 'GET' | 'POST';
  authHeader?: string;
  authValue?: string;
  /** Query/body param name that carries the target URL. */
  urlParam?: string;
  extraParams?: Record<string, string>;
}

/**
 * Generic adapter for "unlocker" gateway APIs (ScraperAPI, ZenRows, Bright Data,
 * ...). New services need configuration, not code.
 */
export class UnlockerApiProvider implements EgressProvider {
  readonly type = 'unlocker-api';
  readonly id: string;
  readonly weight: number;
  readonly capabilities: EgressCapabilities;
  private readonly endpoint: URL;
  private readonly method: 'GET' | 'POST';
  private readonly urlParam: string;
  private readonly extraParams: Record<string, string>;
  private readonly authHeader: string | undefined;
  private readonly authValue: string | undefined;
  private readonly timeoutMs: number;

  constructor(options: UnlockerApiProviderOptions) {
    this.id = options.id;
    this.endpoint = new URL(options.url);
    this.weight = options.weight ?? 1;
    this.capabilities = options.capabilities ?? {};
    this.timeoutMs = options.timeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
    this.method = options.method ?? 'GET';
    this.urlParam = options.urlParam ?? 'url';
    this.extraParams = options.extraParams ?? {};
    this.authHeader = options.authHeader;
    this.authValue = options.authValue;
  }

  private buildRequest(req: EgressRequest, signal?: AbortSignal): RawRequestInput {
    const headers: Record<string, string> = { ...(req.headers ?? {}) };
    if (this.authHeader && this.authValue) headers[this.authHeader] = this.authValue;

    let target: URL;
    let body: string | undefined;

    if (this.method === 'GET') {
      target = new URL(this.endpoint.toString());
      target.searchParams.set(this.urlParam, req.url.toString());
      for (const [key, value] of Object.entries(this.extraParams)) {
        target.searchParams.set(key, value);
      }
    } else {
      target = new URL(this.endpoint.toString());
      headers['content-type'] = 'application/json';
      body = JSON.stringify({ [this.urlParam]: req.url.toString(), ...this.extraParams });
    }

    const input: RawRequestInput = { url: target, method: this.method, timeoutMs: this.timeoutMs };
    input.headers = headers;
    if (body !== undefined) input.body = body;
    if (signal) input.signal = signal;
    return input;
  }

  async request(req: EgressRequest, opts?: EgressRequestOptions): Promise<EgressResponse> {
    let result: RawResponse;
    try {
      result = await performUndiciRequest(this.buildRequest(req, opts?.signal));
    } catch (error) {
      throw new EgressRequestError(this.id, errorMessage(error), { cause: error });
    }
    return { ...result, providerId: this.id };
  }
}
