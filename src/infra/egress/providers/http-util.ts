import { request as undiciRequest, type Agent, type Dispatcher } from 'undici';
import http from 'node:http';
import https from 'node:https';
import { brotliDecompressSync, gunzipSync, inflateSync } from 'node:zlib';
import { type EgressMethod, type EgressRequest } from '../egress-provider.interface.js';

export type HeaderLike = Record<string, string | string[] | undefined>;

/**
 * Redirect hop cap, mirroring the legacy axios default `maxRedirects: 5`.
 * undici 7's `request()` no longer supports a native `redirect` option, and the
 * node http/https transports never did, so both paths follow redirects here.
 */
export const MAX_REDIRECTS = 5;

function isRedirectStatus(status: number): boolean {
  return status >= 300 && status < 400;
}

function isSameOrigin(a: URL, b: URL): boolean {
  return (
    a.protocol === b.protocol && a.hostname === b.hostname && (a.port || '') === (b.port || '')
  );
}

/** Drop credentials when a redirect crosses origins (Fetch-spec behaviour). */
function stripCrossOriginCredentials(
  headers: Record<string, string> | undefined,
  origin: URL,
  target: URL,
): Record<string, string> | undefined {
  if (!headers || isSameOrigin(origin, target)) return headers;
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    const lower = key.toLowerCase();
    if (lower === 'authorization' || lower === 'cookie' || lower === 'proxy-authorization') {
      continue;
    }
    out[key] = value;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

export function normalizeHeaders(headers: HeaderLike): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    if (value === undefined) continue;
    out[key.toLowerCase()] = Array.isArray(value) ? value.join(', ') : value;
  }
  return out;
}

/**
 * Decode a response body byte buffer per its `content-encoding` header.
 * `undici.request()` and the node transports return raw (compressed) bytes,
 * unlike `fetch()`, so this is required to parse real pages. Falls back to the
 * raw bytes when the encoding is unknown or the body is not actually
 * compressed (stale header).
 */
export function decompressBody(buffer: Buffer, contentEncoding: string | undefined): string {
  if (!contentEncoding) return buffer.toString('utf8');
  const token = contentEncoding
    .split(',')
    .map((part) => part.trim().toLowerCase())
    .filter(Boolean)
    .at(-1);
  try {
    if (token === 'gzip' || token === 'x-gzip') return gunzipSync(buffer).toString('utf8');
    if (token === 'deflate') return inflateSync(buffer).toString('utf8');
    if (token === 'br') return brotliDecompressSync(buffer).toString('utf8');
  } catch {
    // Not actually compressed or truncated — fall through to raw bytes.
  }
  return buffer.toString('utf8');
}

export interface RawRequestInput {
  url: URL;
  method: EgressMethod;
  headers?: Record<string, string>;
  body?: string;
  signal?: AbortSignal;
  timeoutMs: number;
}

export interface RawResponse {
  status: number;
  headers: Record<string, string>;
  body: string;
  latencyMs: number;
}

/** Build a RawRequestInput without assigning `undefined` to optional props. */
export function toRawInput(
  request: EgressRequest,
  timeoutMs: number,
  signal?: AbortSignal,
): RawRequestInput {
  const input: RawRequestInput = { url: request.url, method: request.method, timeoutMs };
  if (request.headers) input.headers = request.headers;
  if (request.body !== undefined) input.body = request.body;
  if (signal) input.signal = signal;
  return input;
}

/**
 * undici transport with manual redirect following (undici 7's `request()` no
 * longer supports the `redirect` option; it must be handled here). Cap matches
 * the node path and legacy axios. 301/302/303 downgrade POST to GET per the
 * Fetch spec; 307/308 keep method and body.
 */
export async function performUndiciRequest(
  input: RawRequestInput & { dispatcher?: Dispatcher },
): Promise<RawResponse> {
  const started = Date.now();
  let current = input.url;
  let method = input.method;
  let body = input.body;

  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    const options: Parameters<typeof undiciRequest>[1] = {
      method,
      headersTimeout: input.timeoutMs,
      bodyTimeout: input.timeoutMs,
    };
    const hopHeaders = stripCrossOriginCredentials(input.headers, input.url, current);
    if (hopHeaders) {
      if (method === 'GET') {
        // Never mutate the caller's headers: drop body headers per-hop instead.
        options.headers = { ...hopHeaders };
        delete options.headers['content-length'];
        delete options.headers['content-type'];
      } else {
        options.headers = hopHeaders;
      }
    }
    if (method === 'POST' && body !== undefined) options.body = body;
    if (input.dispatcher) options.dispatcher = input.dispatcher;
    if (input.signal) options.signal = input.signal;

    const response = await undiciRequest(current, options);
    const headers = normalizeHeaders(response.headers);
    const buffer = Buffer.from(await response.body.arrayBuffer());
    const result: RawResponse = {
      status: response.statusCode,
      headers,
      body: decompressBody(buffer, headers['content-encoding']),
      latencyMs: Date.now() - started,
    };

    if (!isRedirectStatus(result.status)) return result;
    const location = headers.location;
    if (!location) return result;
    current = new URL(location, current);
    if (result.status === 301 || result.status === 302 || result.status === 303) {
      method = 'GET';
      body = undefined;
    }
  }

  throw new Error(`Too many redirects while fetching ${input.url.toString()}`);
}

/** One hop of the node http/https transport; resolves the hop's raw response. */
function nodeRequestOnce(
  input: RawRequestInput & { agent?: http.Agent | https.Agent },
  url: URL,
  method: EgressMethod,
  body: string | undefined,
  started: number,
): Promise<RawResponse> {
  return new Promise<RawResponse>((resolve, reject) => {
    const transport = url.protocol === 'https:' ? https : http;
    let headers = stripCrossOriginCredentials(input.headers, input.url, url);
    if (method === 'GET') {
      // Never mutate the caller's headers: drop body headers per-hop instead.
      headers = headers ? { ...headers } : headers;
      if (headers) {
        delete headers['content-length'];
        delete headers['content-type'];
      }
    }
    const request = transport.request(
      url,
      {
        method,
        ...(headers ? { headers } : {}),
        ...(input.agent ? { agent: input.agent } : {}),
      },
      (response) => {
        const chunks: Buffer[] = [];
        response.on('data', (chunk: Buffer) => chunks.push(chunk));
        response.on('end', () => {
          const headers = normalizeHeaders(response.headers);
          resolve({
            status: response.statusCode ?? 0,
            headers,
            body: decompressBody(Buffer.concat(chunks), headers['content-encoding']),
            latencyMs: Date.now() - started,
          });
        });
      },
    );

    request.on('error', reject);
    if (input.signal) {
      if (input.signal.aborted) {
        request.destroy(new Error('aborted'));
      } else {
        input.signal.addEventListener('abort', () => request.destroy(new Error('aborted')), {
          once: true,
        });
      }
    }
    request.setTimeout(input.timeoutMs, () =>
      request.destroy(new Error(`timed out after ${input.timeoutMs}ms`)),
    );
    if (body) request.write(body);
    request.end();
  });
}

/**
 * Node `http`/`https` transport with manual redirect following (the node
 * transports do not follow redirects on their own). Cap matches the undici
 * path and legacy axios. 301/302/303 downgrade POST to GET per the Fetch spec;
 * 307/308 keep method and body.
 */
export async function performNodeRequest(
  input: RawRequestInput & { agent?: http.Agent | https.Agent },
): Promise<RawResponse> {
  const started = Date.now();
  let current = input.url;
  let method = input.method;
  let body = input.body;

  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    const response = await nodeRequestOnce(input, current, method, body, started);
    if (!isRedirectStatus(response.status)) return response;

    const location = response.headers.location;
    if (!location) return response;
    current = new URL(location, current);
    if (response.status === 301 || response.status === 302 || response.status === 303) {
      method = 'GET';
      body = undefined;
    }
  }

  throw new Error(`Too many redirects while fetching ${input.url.toString()}`);
}

export function errorMessage(error: unknown): string {
  if (error instanceof Error) {
    // Redact anything that looks like credentials in a message.
    return error.message.replace(/\/\/[^/@\s]+@/g, '//***@');
  }
  return String(error);
}

export type { Agent };
