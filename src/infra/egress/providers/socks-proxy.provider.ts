import { SocksProxyAgent } from 'socks-proxy-agent';
import {
  EgressRequestError,
  type EgressCapabilities,
  type EgressProvider,
  type EgressRequest,
  type EgressRequestOptions,
  type EgressResponse,
} from '../egress-provider.interface.js';
import { DEFAULT_REQUEST_TIMEOUT_MS } from './direct.provider.js';
import { errorMessage, performNodeRequest, toRawInput } from './http-util.js';

export interface SocksProxyProviderOptions {
  id: string;
  url: string;
  weight?: number;
  capabilities?: EgressCapabilities;
  timeoutMs?: number;
}

/** Routes requests through a SOCKS4/SOCKS5 proxy (with optional auth). */
export class SocksProxyProvider implements EgressProvider {
  readonly type = 'socks';
  readonly id: string;
  readonly weight: number;
  readonly capabilities: EgressCapabilities;
  private readonly agent: SocksProxyAgent;
  private readonly timeoutMs: number;

  constructor(options: SocksProxyProviderOptions) {
    this.id = options.id;
    this.weight = options.weight ?? 1;
    this.capabilities = options.capabilities ?? {};
    this.timeoutMs = options.timeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
    this.agent = new SocksProxyAgent(options.url);
  }

  async request(req: EgressRequest, opts?: EgressRequestOptions): Promise<EgressResponse> {
    try {
      const result = await performNodeRequest({
        ...toRawInput(req, this.timeoutMs, opts?.signal),
        agent: this.agent,
      });
      return { ...result, providerId: this.id };
    } catch (error) {
      throw new EgressRequestError(this.id, errorMessage(error), { cause: error });
    }
  }

  close(): Promise<void> {
    this.agent.destroy();
    return Promise.resolve();
  }
}
