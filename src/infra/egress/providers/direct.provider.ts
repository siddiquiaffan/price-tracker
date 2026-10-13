import {
  EgressRequestError,
  type EgressCapabilities,
  type EgressProvider,
  type EgressRequest,
  type EgressRequestOptions,
  type EgressResponse,
} from '../egress-provider.interface.js';
import { errorMessage, performUndiciRequest, toRawInput } from './http-util.js';

export interface DirectProviderOptions {
  id?: string;
  weight?: number;
  capabilities?: EgressCapabilities;
  timeoutMs?: number;
}

export const DEFAULT_REQUEST_TIMEOUT_MS = 15_000;

/** No proxy: direct egress. For local dev and tests. */
export class DirectProvider implements EgressProvider {
  readonly type = 'direct';
  readonly id: string;
  readonly weight: number;
  readonly capabilities: EgressCapabilities;
  private readonly timeoutMs: number;

  constructor(options: DirectProviderOptions = {}) {
    this.id = options.id ?? 'direct';
    this.weight = options.weight ?? 1;
    this.capabilities = options.capabilities ?? {};
    this.timeoutMs = options.timeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
  }

  async request(req: EgressRequest, opts?: EgressRequestOptions): Promise<EgressResponse> {
    try {
      const result = await performUndiciRequest(toRawInput(req, this.timeoutMs, opts?.signal));
      return { ...result, providerId: this.id };
    } catch (error) {
      throw new EgressRequestError(this.id, errorMessage(error), { cause: error });
    }
  }
}
