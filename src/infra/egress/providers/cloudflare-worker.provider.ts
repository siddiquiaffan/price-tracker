import {
  EgressRequestError,
  type EgressCapabilities,
  type EgressProvider,
  type EgressRequest,
  type EgressRequestOptions,
  type EgressResponse,
} from '../egress-provider.interface.js';
import {
  WORKER_ERROR_HEADER,
  WORKER_ERROR_MESSAGE_HEADER,
  WORKER_QUERY_PARAM,
  WORKER_SECRET_HEADER,
} from '../worker-contract.js';
import { DEFAULT_REQUEST_TIMEOUT_MS } from './direct.provider.js';
import { errorMessage, performUndiciRequest, type RawRequestInput } from './http-util.js';

export interface CloudflareWorkerProviderOptions {
  id: string;
  url: string;
  secret?: string;
  weight?: number;
  capabilities?: EgressCapabilities;
  timeoutMs?: number;
}

/** Calls a Cloudflare Worker gateway that fetches the target URL server-side. */
export class CloudflareWorkerProvider implements EgressProvider {
  readonly type = 'cloudflare-worker';
  readonly id: string;
  readonly weight: number;
  readonly capabilities: EgressCapabilities;
  private readonly workerUrl: URL;
  private readonly secret: string | undefined;
  private readonly timeoutMs: number;

  constructor(options: CloudflareWorkerProviderOptions) {
    this.id = options.id;
    this.workerUrl = new URL(options.url);
    this.secret = options.secret;
    this.weight = options.weight ?? 1;
    this.capabilities = options.capabilities ?? {};
    this.timeoutMs = options.timeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
  }

  async request(req: EgressRequest, opts?: EgressRequestOptions): Promise<EgressResponse> {
    const target = new URL(this.workerUrl.toString());
    target.searchParams.set(WORKER_QUERY_PARAM, req.url.toString());

    const headers: Record<string, string> = { ...(req.headers ?? {}) };
    if (this.secret) headers[WORKER_SECRET_HEADER] = this.secret;

    const input: RawRequestInput = { url: target, method: req.method, timeoutMs: this.timeoutMs };
    input.headers = headers;
    if (req.body !== undefined) input.body = req.body;
    if (opts?.signal) input.signal = opts.signal;

    let result;
    try {
      result = await performUndiciRequest(input);
    } catch (error) {
      throw new EgressRequestError(this.id, errorMessage(error), { cause: error });
    }

    const workerError = result.headers[WORKER_ERROR_HEADER];
    if (workerError) {
      const message = result.headers[WORKER_ERROR_MESSAGE_HEADER] ?? workerError;
      throw new EgressRequestError(this.id, `worker error (${workerError}): ${message}`);
    }

    return { ...result, providerId: this.id };
  }
}
