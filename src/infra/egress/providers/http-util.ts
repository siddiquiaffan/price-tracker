import { request as undiciRequest, type Agent, type Dispatcher } from 'undici';
import http from 'node:http';
import https from 'node:https';
import { type EgressMethod, type EgressRequest } from '../egress-provider.interface.js';

export type HeaderLike = Record<string, string | string[] | undefined>;

export function normalizeHeaders(headers: HeaderLike): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    if (value === undefined) continue;
    out[key.toLowerCase()] = Array.isArray(value) ? value.join(', ') : value;
  }
  return out;
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

export async function performUndiciRequest(
  input: RawRequestInput & { dispatcher?: Dispatcher },
): Promise<RawResponse> {
  const started = Date.now();
  const options: Parameters<typeof undiciRequest>[1] = {
    method: input.method,
    headersTimeout: input.timeoutMs,
    bodyTimeout: input.timeoutMs,
  };
  if (input.headers) options.headers = input.headers;
  if (input.method === 'POST' && input.body !== undefined) options.body = input.body;
  if (input.dispatcher) options.dispatcher = input.dispatcher;
  if (input.signal) options.signal = input.signal;

  const response = await undiciRequest(input.url, options);
  const headers = normalizeHeaders(response.headers);
  const body = await response.body.text();
  return { status: response.statusCode, headers, body, latencyMs: Date.now() - started };
}

export async function performNodeRequest(
  input: RawRequestInput & { agent?: http.Agent | https.Agent },
): Promise<RawResponse> {
  const started = Date.now();
  return new Promise<RawResponse>((resolve, reject) => {
    const transport = input.url.protocol === 'https:' ? https : http;
    const request = transport.request(
      input.url,
      {
        method: input.method,
        headers: input.headers,
        ...(input.agent ? { agent: input.agent } : {}),
      },
      (response) => {
        const chunks: Buffer[] = [];
        response.on('data', (chunk: Buffer) => chunks.push(chunk));
        response.on('end', () => {
          resolve({
            status: response.statusCode ?? 0,
            headers: normalizeHeaders(response.headers),
            body: Buffer.concat(chunks).toString('utf8'),
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
    if (input.body) request.write(input.body);
    request.end();
  });
}

export function errorMessage(error: unknown): string {
  if (error instanceof Error) {
    // Redact anything that looks like credentials in a message.
    return error.message.replace(/\/\/[^/@\s]+@/g, '//***@');
  }
  return String(error);
}

export type { Agent };
