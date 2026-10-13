export type FetchMethod = 'GET' | 'POST';

export interface FetchRequest {
  url: URL;
  method?: FetchMethod;
  headers?: Record<string, string>;
  body?: string;
  /** Used for per-store egress routing policy. */
  storeId?: string;
}

export interface FetchResponse {
  status: number;
  headers: Record<string, string>;
  body: string;
  /** The egress provider that served the request (for observability). */
  providerId: string;
}

export interface FetchOptions {
  signal?: AbortSignal;
  sessionId?: string;
}

/**
 * The single outbound-HTTP port. All scraping traffic goes through this; nothing
 * outside the egress layer may call `fetch`/`undici` directly.
 */
export interface Fetcher {
  fetch(request: FetchRequest, options?: FetchOptions): Promise<FetchResponse>;
}
