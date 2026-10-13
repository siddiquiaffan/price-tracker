/**
 * Cloudflare Worker gateway used by the `cloudflare-worker` egress provider.
 *
 * Behaviour (superset of the legacy `worker.js`):
 *  - fetches the target URL carried in the `?url=` query param with the same
 *    method/headers/body as the incoming request,
 *  - returns the upstream status code and headers (the legacy worker always
 *    returned 200, which broke block detection — fixed),
 *  - stamps `x-final-url` with the post-redirect URL so the SSRF/URL layer can
 *    see where redirects landed,
 *  - refuses requests without a valid `x-egress-secret` (optional but strongly
 *    recommended; the legacy worker was an unauthenticated open proxy),
 *  - only allows hosts in `WORKER_ALLOWED_HOSTS` (default: Amazon.in + Flipkart).
 *
 * Keep in sync with `src/infra/egress/worker-contract.ts`.
 */

const QUERY_PARAM = 'url';
const SECRET_HEADER = 'x-egress-secret';
const FINAL_URL_HEADER = 'x-final-url';
const ERROR_HEADER = 'x-egress-error';
const ERROR_MESSAGE_HEADER = 'x-egress-error-message';

const DEFAULT_ALLOWED_HOSTS = ['amazon.in', 'amzn.in', 'flipkart.com', 'dl.flipkart.com'] as const;

interface Env {
  WORKER_SECRET?: string;
  WORKER_ALLOWED_HOSTS?: string;
}

function isHostAllowed(hostname: string, allowedHosts: readonly string[]): boolean {
  const host = hostname.replace(/^www\./i, '').toLowerCase();
  return allowedHosts.some((candidate) => {
    const allowed = candidate.toLowerCase();
    return host === allowed || host.endsWith(`.${allowed}`);
  });
}

function errorResponse(code: string, message: string): Response {
  return new Response(JSON.stringify({ error: code, message }), {
    status: 200,
    headers: {
      [ERROR_HEADER]: code,
      [ERROR_MESSAGE_HEADER]: message,
      'content-type': 'application/json',
    },
  });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const targetRaw = url.searchParams.get(QUERY_PARAM);
    if (!targetRaw || targetRaw.trim().length === 0) {
      return errorResponse('missing_url', 'missing ?url= parameter');
    }

    const secret = request.headers.get(SECRET_HEADER);
    if (env.WORKER_SECRET !== undefined && secret !== env.WORKER_SECRET) {
      return errorResponse('unauthorized', 'invalid egress secret');
    }

    let target: URL;
    try {
      target = new URL(targetRaw);
    } catch {
      return errorResponse('missing_url', 'target is not a valid URL');
    }

    const rawAllowed = env.WORKER_ALLOWED_HOSTS ?? DEFAULT_ALLOWED_HOSTS.join(',');
    const allowedHosts = rawAllowed
      .split(',')
      .map((host) => host.trim().toLowerCase())
      .filter((host) => host.length > 0);
    if (!isHostAllowed(target.hostname, allowedHosts)) {
      return errorResponse('host_not_allowed', `host not allowed: ${target.hostname}`);
    }

    try {
      const init: RequestInit = {
        method: request.method,
        headers: request.headers,
        redirect: 'follow',
      };
      if (request.method !== 'GET' && request.method !== 'HEAD') init.body = request.body;
      const upstream = await fetch(target, init);

      const responseHeaders = new Headers(upstream.headers);
      responseHeaders.set(FINAL_URL_HEADER, upstream.url);

      const body = await upstream.arrayBuffer();
      return new Response(body, { status: upstream.status, headers: responseHeaders });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return errorResponse('upstream_failed', message);
    }
  },
};
