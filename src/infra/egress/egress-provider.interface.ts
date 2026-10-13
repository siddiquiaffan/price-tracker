import { ScrapeError, type AppErrorOptions } from '../../core/errors/app-error.js';

export type EgressMethod = 'GET' | 'POST';

export interface EgressRequest {
  url: URL;
  method: EgressMethod;
  headers?: Record<string, string>;
  body?: string;
}

export interface EgressResponse {
  status: number;
  headers: Record<string, string>;
  body: string;
  providerId: string;
  latencyMs: number;
}

export interface EgressCapabilities {
  jsRendering?: boolean | undefined;
  geo?: string[] | undefined;
  stickySessions?: boolean | undefined;
}

export interface EgressRequestOptions {
  signal?: AbortSignal;
  sessionId?: string;
}

/** Two kinds of egress share one contract: connection proxies and gateways. */
export interface EgressProvider {
  readonly id: string;
  readonly type: string;
  readonly weight: number;
  readonly capabilities: EgressCapabilities;
  request(req: EgressRequest, opts?: EgressRequestOptions): Promise<EgressResponse>;
  healthCheck?(): Promise<boolean>;
  close?(): Promise<void>;
}

/** A provider-level request failure (network, timeout, DNS, TLS). Retryable. */
export class EgressRequestError extends ScrapeError {
  override readonly name: string = 'EgressRequestError';
  constructor(
    readonly providerId: string,
    message: string,
    options: AppErrorOptions = {},
  ) {
    super(`[${providerId}] ${message}`, options);
  }
}
