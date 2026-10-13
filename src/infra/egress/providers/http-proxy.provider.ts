import { ProxyAgent } from 'undici';
import {
  EgressRequestError,
  type EgressCapabilities,
  type EgressProvider,
  type EgressRequest,
  type EgressRequestOptions,
  type EgressResponse,
} from '../egress-provider.interface.js';
import { DEFAULT_REQUEST_TIMEOUT_MS } from './direct.provider.js';
import { errorMessage, performUndiciRequest, toRawInput } from './http-util.js';

export interface HttpProxyProviderOptions {
  id: string;
  url: string;
  weight?: number;
  capabilities?: EgressCapabilities;
  timeoutMs?: number;
}

/** Routes requests through an HTTP/HTTPS connection proxy (with optional auth). */
export class HttpProxyProvider implements EgressProvider {
  readonly type = 'http-proxy';
  readonly id: string;
  readonly weight: number;
  readonly capabilities: EgressCapabilities;
  private readonly agent: ProxyAgent;
  private readonly timeoutMs: number;

  constructor(options: HttpProxyProviderOptions) {
    this.id = options.id;
    this.weight = options.weight ?? 1;
    this.capabilities = options.capabilities ?? {};
    this.timeoutMs = options.timeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
    this.agent = new ProxyAgent(options.url);
  }

  async request(req: EgressRequest, opts?: EgressRequestOptions): Promise<EgressResponse> {
    try {
      const result = await performUndiciRequest({
        ...toRawInput(req, this.timeoutMs, opts?.signal),
        dispatcher: this.agent,
      });
      return { ...result, providerId: this.id };
    } catch (error) {
      throw new EgressRequestError(this.id, errorMessage(error), { cause: error });
    }
  }

  async close(): Promise<void> {
    await this.agent.close();
  }
}
