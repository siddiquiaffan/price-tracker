import {
  type Fetcher,
  type FetchRequest,
  type FetchResponse,
  type FetchOptions,
} from '../../core/ports/fetcher.js';
import { type Logger } from '../../core/ports/logger.js';
import { type EgressPoolRegistry } from '../egress/egress-pool-registry.js';
import { type EgressRequest } from '../egress/egress-provider.interface.js';

export interface EgressFetcherOptions {
  pools: EgressPoolRegistry;
  logger: Logger;
  /** Hard timeout for the whole request (including failover attempts). */
  timeoutMs: number;
}

/**
 * Implements the {@link Fetcher} port on top of the egress pool registry.
 * This is the only place in the codebase that performs outbound HTTP.
 */
export class EgressFetcher implements Fetcher {
  private readonly pools: EgressPoolRegistry;
  private readonly logger: Logger;
  private readonly timeoutMs: number;

  constructor(options: EgressFetcherOptions) {
    this.pools = options.pools;
    this.logger = options.logger;
    this.timeoutMs = options.timeoutMs;
  }

  async fetch(request: FetchRequest, options?: FetchOptions): Promise<FetchResponse> {
    const pool = this.pools.forStore(request.storeId);
    const controller = new AbortController();
    const timer = setTimeout(() => {
      controller.abort(new Error(`request timed out after ${this.timeoutMs}ms`));
    }, this.timeoutMs);

    const externalSignal = options?.signal;
    const onAbort = (): void => {
      controller.abort(externalSignal?.reason);
    };
    if (externalSignal) {
      if (externalSignal.aborted) controller.abort(externalSignal.reason);
      else externalSignal.addEventListener('abort', onAbort, { once: true });
    }

    const egressRequest: EgressRequest = {
      url: request.url,
      method: request.method ?? 'GET',
    };
    if (request.headers) egressRequest.headers = request.headers;
    if (request.body !== undefined) egressRequest.body = request.body;

    try {
      const response = await pool.request(egressRequest, {
        signal: controller.signal,
        ...(options?.sessionId !== undefined ? { sessionId: options.sessionId } : {}),
      });
      return {
        status: response.status,
        headers: response.headers,
        body: response.body,
        providerId: response.providerId,
      };
    } catch (error) {
      this.logger.debug({ error, storeId: request.storeId }, 'egress fetch failed');
      throw error;
    } finally {
      clearTimeout(timer);
      if (externalSignal) externalSignal.removeEventListener('abort', onAbort);
    }
  }
}
