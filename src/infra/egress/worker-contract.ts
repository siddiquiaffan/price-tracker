/**
 * Shared contract between `CloudflareWorkerProvider` and the Cloudflare Worker in
 * `/worker`. Kept inside `src/` so the main build (rootDir: src) can compile it.
 */

export const WORKER_QUERY_PARAM = 'url';
export const WORKER_SECRET_HEADER = 'x-egress-secret';
export const WORKER_FINAL_URL_HEADER = 'x-final-url';
export const WORKER_ERROR_HEADER = 'x-egress-error';
export const WORKER_ERROR_MESSAGE_HEADER = 'x-egress-error-message';

export type WorkerErrorCode =
  'missing_url' | 'unauthorized' | 'host_not_allowed' | 'upstream_failed';

export interface WorkerErrorBody {
  error: WorkerErrorCode;
  message: string;
}

export function isWorkerErrorBody(value: unknown): value is WorkerErrorBody {
  if (typeof value !== 'object' || value === null) return false;
  const record = value as Record<string, unknown>;
  return typeof record.error === 'string' && typeof record.message === 'string';
}

/** Host is allowed if it equals or is a subdomain of an allow-listed host. */
export function isHostAllowed(hostname: string, allowedHosts: readonly string[]): boolean {
  const host = hostname.replace(/^www\./i, '').toLowerCase();
  return allowedHosts.some((allowed) => {
    const candidate = allowed.toLowerCase();
    return host === candidate || host.endsWith(`.${candidate}`);
  });
}
