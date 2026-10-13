import http from 'node:http';
import net from 'node:net';
import type { AddressInfo } from 'node:net';
import { brotliCompressSync, deflateSync, gzipSync } from 'node:zlib';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { getGlobalDispatcher, MockAgent, setGlobalDispatcher, type Dispatcher } from 'undici';
import { CompositeBlockDetector } from '../../src/infra/egress/block-detector.js';
import {
  EgressRequestError,
  type EgressResponse,
} from '../../src/infra/egress/egress-provider.interface.js';
import {
  createProviderRegistry,
  ProviderRegistry,
} from '../../src/infra/egress/provider-registry.js';
import { CloudflareWorkerProvider } from '../../src/infra/egress/providers/cloudflare-worker.provider.js';
import { DirectProvider } from '../../src/infra/egress/providers/direct.provider.js';
import { HttpProxyProvider } from '../../src/infra/egress/providers/http-proxy.provider.js';
import { SocksProxyProvider } from '../../src/infra/egress/providers/socks-proxy.provider.js';
import { UnlockerApiProvider } from '../../src/infra/egress/providers/unlocker-api.provider.js';
import {
  decompressBody,
  errorMessage,
  normalizeHeaders,
  performNodeRequest,
  performUndiciRequest,
  toRawInput,
} from '../../src/infra/egress/providers/http-util.js';
import { isHostAllowed, isWorkerErrorBody } from '../../src/infra/egress/worker-contract.js';

/* ------------------------------------------------------------------ */
/* Block detector + worker contract + http-util (pure units)           */
/* ------------------------------------------------------------------ */

describe('CompositeBlockDetector', () => {
  const detector = new CompositeBlockDetector();

  it('blocks on status 403 and 429 regardless of body', () => {
    expect(detector.isBlocked({ status: 403, body: 'clean', headers: {} })).toBe(true);
    expect(detector.isBlocked({ status: 429, body: 'clean', headers: {} })).toBe(true);
  });

  it('blocks on body signals and allows 404 pages', () => {
    expect(
      detector.isBlocked({ status: 200, body: 'Enter the characters you see below', headers: {} }),
    ).toBe(true);
    expect(detector.isBlocked({ status: 200, body: '<span>normal page</span>', headers: {} })).toBe(
      false,
    );
    expect(detector.isBlocked({ status: 404, body: 'page not found', headers: {} })).toBe(false);
  });

  it('honours store-specific rules', () => {
    const withRule = new CompositeBlockDetector();
    withRule.register('amazon', { isBlocked: () => true });
    expect(withRule.isBlocked({ status: 200, body: 'clean', headers: {} })).toBe(true);
  });

  it('reports the blocking reason', () => {
    expect(detector.reason({ status: 403, body: 'x', headers: {} })).toBe('status 403');
    expect(detector.reason({ status: 429, body: 'x', headers: {} })).toBe(
      'status 429 (rate limited)',
    );
    expect(detector.reason({ status: 200, body: 'a robot check happened', headers: {} })).toContain(
      'robot check',
    );
    expect(detector.isBlocked({ status: 200, body: 'a robot check happened', headers: {} })).toBe(
      true,
    );
    const storeRule = new CompositeBlockDetector();
    storeRule.register('flipkart', { isBlocked: () => true, reason: () => 'flipkart rule' });
    expect(storeRule.reason({ status: 200, body: 'clean', headers: {} })).toBe(
      'store rule (flipkart)',
    );
    expect(detector.reason({ status: 200, body: 'clean', headers: {} })).toBeUndefined();
  });
});

describe('worker contract', () => {
  it('validates worker error bodies', () => {
    expect(isWorkerErrorBody({ error: 'unauthorized', message: 'no' })).toBe(true);
    expect(isWorkerErrorBody(null)).toBe(false);
    expect(isWorkerErrorBody('string')).toBe(false);
    expect(isWorkerErrorBody({ error: 1, message: 'no' })).toBe(false);
    expect(isWorkerErrorBody({ error: 'x' })).toBe(false);
  });

  it('allow-lists hosts with www and subdomain matching', () => {
    const allowed = ['amazon.in', 'flipkart.com'];
    expect(isHostAllowed('www.amazon.in', allowed)).toBe(true);
    expect(isHostAllowed('m.media.flipkart.com', allowed)).toBe(true);
    expect(isHostAllowed('AMAZON.IN', allowed)).toBe(true);
    expect(isHostAllowed('notamazon.in', allowed)).toBe(false);
    expect(isHostAllowed('amazon.in.evil.com', allowed)).toBe(false);
  });
});

describe('http-util helpers', () => {
  it('normalises headers to lowercase strings', () => {
    expect(
      normalizeHeaders({ 'Content-Type': 'text/html', 'X-Multi': ['a', 'b'], Skip: undefined }),
    ).toEqual({
      'content-type': 'text/html',
      'x-multi': 'a, b',
    });
  });

  it('builds raw inputs without assigning undefined', () => {
    const bare = toRawInput({ url: new URL('https://a.com/'), method: 'GET' }, 5000);
    expect(bare.url.toString()).toBe('https://a.com/');
    expect('headers' in bare).toBe(false);
    const withExtras = toRawInput(
      { url: new URL('https://a.com/'), method: 'POST', headers: { a: '1' }, body: '{}' },
      5000,
      new AbortController().signal,
    );
    expect(withExtras.headers).toEqual({ a: '1' });
    expect(withExtras.body).toBe('{}');
    expect(withExtras.signal).toBeDefined();
  });

  it('redacts credentials in error messages and stringifies non-errors', () => {
    expect(errorMessage(new Error('https://user:password@proxy.example/x failed'))).toBe(
      'https://***@proxy.example/x failed',
    );
    expect(errorMessage('boom')).toBe('boom');
  });

  it('decompresses gzip, deflate, and brotli bodies per content-encoding', () => {
    const html = '<!doctype html><h1>landed</h1>';
    expect(decompressBody(gzipSync(Buffer.from(html)), 'gzip')).toBe(html);
    expect(decompressBody(deflateSync(Buffer.from(html)), 'deflate')).toBe(html);
    expect(decompressBody(brotliCompressSync(Buffer.from(html)), 'br')).toBe(html);
    expect(decompressBody(Buffer.from(html), undefined)).toBe(html);
    expect(decompressBody(Buffer.from('plain'), 'identity')).toBe('plain');
    // Stale/mismatched header: fall back to the raw bytes rather than crash.
    expect(decompressBody(Buffer.from('not compressed'), 'gzip')).toBe('not compressed');
  });
});

describe('performNodeRequest', () => {
  async function listen(server: http.Server): Promise<AddressInfo> {
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    return server.address() as AddressInfo;
  }

  it('performs a plain http request', async () => {
    const server = http.createServer((req, res) => {
      res.writeHead(200, { 'content-type': 'application/json', 'x-echo': req.url ?? '' });
      res.end(JSON.stringify({ ok: true }));
    });
    const { port } = await listen(server);
    try {
      const result = await performNodeRequest({
        url: new URL(`http://127.0.0.1:${port}/ping?q=1`),
        method: 'GET',
        timeoutMs: 2000,
      });
      expect(result.status).toBe(200);
      expect(JSON.parse(result.body)).toEqual({ ok: true });
      expect(result.headers['x-echo']).toBe('/ping?q=1');
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });

  it('rejects when the connection is refused', async () => {
    const probe = http.createServer(() => {
      /* never responds: exercise the error path */
    });
    const { port } = await listen(probe);
    await new Promise((resolve) => probe.close(resolve));
    await expect(
      performNodeRequest({
        url: new URL(`http://127.0.0.1:${port}/`),
        method: 'GET',
        timeoutMs: 2000,
      }),
    ).rejects.toThrow();
  });

  it('aborts an in-flight request on a pre-aborted signal', async () => {
    const server = http.createServer(() => {
      /* never responds: exercise the abort path */
    });
    const { port } = await listen(server);
    const controller = new AbortController();
    controller.abort();
    try {
      await expect(
        performNodeRequest({
          url: new URL(`http://127.0.0.1:${port}/`),
          method: 'GET',
          timeoutMs: 2000,
          signal: controller.signal,
        }),
      ).rejects.toThrow();
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });

  it('times out when the server never responds', async () => {
    const server = http.createServer(() => {
      /* never responds: exercise the timeout path */
    });
    const { port } = await listen(server);
    try {
      await expect(
        performNodeRequest({
          url: new URL(`http://127.0.0.1:${port}/`),
          method: 'GET',
          timeoutMs: 50,
        }),
      ).rejects.toThrow(/timed out/);
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });

  it('follows redirects to the final response', async () => {
    const server = http.createServer((req, res) => {
      if (req.url === '/start') {
        res.writeHead(302, { location: '/final' });
        res.end();
        return;
      }
      res.writeHead(200, { 'content-type': 'text/plain' });
      res.end('landed');
    });
    const { port } = await listen(server);
    try {
      const result = await performNodeRequest({
        url: new URL(`http://127.0.0.1:${port}/start`),
        method: 'GET',
        timeoutMs: 2000,
      });
      expect(result.status).toBe(200);
      expect(result.body).toBe('landed');
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });

  it('stops after the redirect hop cap', async () => {
    const server = http.createServer((_req, res) => {
      res.writeHead(302, { location: '/loop' });
      res.end();
    });
    const { port } = await listen(server);
    try {
      await expect(
        performNodeRequest({
          url: new URL(`http://127.0.0.1:${port}/loop`),
          method: 'GET',
          timeoutMs: 2000,
        }),
      ).rejects.toThrow(/Too many redirects/);
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });
});

/* ------------------------------------------------------------------ */
/* Providers (via undici MockAgent)                                    */
/* ------------------------------------------------------------------ */

const originalDispatcher = getGlobalDispatcher();
const mockAgent = new MockAgent();

beforeAll(() => {
  mockAgent.disableNetConnect();
  setGlobalDispatcher(mockAgent);
});

afterEach(() => {
  mockAgent.assertNoPendingInterceptors?.();
});

afterAll(async () => {
  setGlobalDispatcher(originalDispatcher);
  await mockAgent.close();
});

function okResponse(providerId: string): EgressResponse {
  return {
    status: 200,
    headers: { 'content-type': 'text/html' },
    body: '<html>ok</html>',
    providerId,
    latencyMs: 0,
  };
}

describe('DirectProvider', () => {
  it('fetches the target url directly', async () => {
    mockAgent
      .get('https://target.example')
      .intercept({ path: '/product', method: 'GET', headers: { 'user-agent': 'bot' } })
      .reply(200, '<html>direct</html>', { headers: { 'content-type': 'text/html' } });

    const provider = new DirectProvider({ id: 'direct-1', timeoutMs: 5000 });
    const result = await provider.request({
      url: new URL('https://target.example/product'),
      method: 'GET',
      headers: { 'user-agent': 'bot' },
    });
    expect(result.providerId).toBe('direct-1');
    expect(result.body).toBe('<html>direct</html>');
    expect(result.headers['content-type']).toBe('text/html');
  });

  it('wraps network failures in EgressRequestError', async () => {
    const provider = new DirectProvider({ id: 'direct-2', timeoutMs: 500 });
    await expect(
      provider.request({ url: new URL('https://no-mock-here.example/x'), method: 'GET' }),
    ).rejects.toBeInstanceOf(EgressRequestError);
  });
});

describe('CloudflareWorkerProvider', () => {
  it('forwards the target in the query and the secret in a header', async () => {
    mockAgent
      .get('https://worker.example')
      .intercept({
        path: /\/fetch\?url=/,
        method: 'GET',
        headers: { 'x-egress-secret': 's3cret' },
      })
      .reply(200, '<html>worker</html>', {
        headers: { 'x-final-url': 'https://target.example/product' },
      });

    const provider = new CloudflareWorkerProvider({
      id: 'cf',
      url: 'https://worker.example/fetch',
      secret: 's3cret',
    });
    const result = await provider.request({
      url: new URL('https://target.example/product'),
      method: 'GET',
    });
    expect(result.body).toBe('<html>worker</html>');
    expect(result.headers['x-final-url']).toBe('https://target.example/product');
  });

  it('surfaces worker error headers as EgressRequestError', async () => {
    mockAgent
      .get('https://worker.example')
      .intercept({ path: /\/fetch\?url=/, method: 'GET' })
      .reply(502, 'err', {
        headers: { 'x-egress-error': 'upstream_failed', 'x-egress-error-message': 'boom' },
      });

    const provider = new CloudflareWorkerProvider({
      id: 'cf',
      url: 'https://worker.example/fetch',
    });
    await expect(
      provider.request({ url: new URL('https://target.example/product'), method: 'GET' }),
    ).rejects.toMatchObject({ message: expect.stringContaining('upstream_failed') });
  });

  it('reports transport errors with the provider id', async () => {
    const provider = new CloudflareWorkerProvider({
      id: 'cf',
      url: 'https://no-mock.example/fetch',
    });
    await expect(
      provider.request({ url: new URL('https://target.example/product'), method: 'GET' }),
    ).rejects.toBeInstanceOf(EgressRequestError);
  });
});

describe('UnlockerApiProvider', () => {
  it('sends the target as a query param with auth and extra params', async () => {
    mockAgent
      .get('https://unlocker.example')
      .intercept({
        path: /\/\?api_key=KEY&render=true&url=/,
        method: 'GET',
        headers: { Authorization: 'Bearer tok' },
      })
      .reply(200, '<html>unlocked</html>');

    const provider = new UnlockerApiProvider({
      id: 'unl',
      url: 'https://unlocker.example/?api_key=KEY',
      authHeader: 'Authorization',
      authValue: 'Bearer tok',
      extraParams: { render: 'true' },
      timeoutMs: 5000,
    });
    const result = await provider.request({
      url: new URL('https://target.example/product'),
      method: 'GET',
    });
    expect(result.providerId).toBe('unl');
    expect(result.body).toBe('<html>unlocked</html>');
  });

  it('posts JSON bodies when configured for POST', async () => {
    mockAgent
      .get('https://unlocker.example')
      .intercept({
        path: '/api',
        method: 'POST',
        headers: { 'content-type': 'application/json' },
      })
      .reply(201, '{"skipped":true}');

    const provider = new UnlockerApiProvider({
      id: 'unl-post',
      url: 'https://unlocker.example/api',
      method: 'POST',
      urlParam: 'target',
      extraParams: { country: 'in' },
      timeoutMs: 5000,
    });
    const result = await provider.request({
      url: new URL('https://target.example/product'),
      method: 'POST',
      body: '{}',
    });
    expect(result.status).toBe(201);
  });

  it('wraps failures in EgressRequestError', async () => {
    const provider = new UnlockerApiProvider({ id: 'unl', url: 'https://no-mock.example/api' });
    await expect(
      provider.request({ url: new URL('https://target.example/product'), method: 'GET' }),
    ).rejects.toBeInstanceOf(EgressRequestError);
  });
});

describe('HttpProxyProvider', () => {
  it('routes requests through the configured proxy', async () => {
    let sawRequest = false;
    const PROXY_HTTP_RESPONSE =
      'HTTP/1.1 200 OK\r\nContent-Type: text/html\r\nContent-Length: 22\r\nConnection: close\r\n\r\n<html>via-proxy</html>';
    const proxy = net.createServer((socket) => {
      socket.once('data', (first) => {
        const head = first.toString('latin1');
        if (/^CONNECT /i.test(head)) {
          // CONNECT tunnel: acknowledge, then answer the HTTP request inside it.
          socket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
          let pending = Buffer.alloc(0);
          const onTunnelData = (chunk: Buffer): void => {
            pending = Buffer.concat([pending, chunk]);
            if (pending.indexOf('\r\n\r\n') !== -1) {
              sawRequest = true;
              socket.write(PROXY_HTTP_RESPONSE, () => socket.end());
            }
          };
          socket.on('data', onTunnelData);
        } else {
          // Absolute-form request to an http proxy.
          sawRequest = true;
          socket.write(PROXY_HTTP_RESPONSE);
          socket.end();
        }
      });
      socket.on('error', () => {
        /* the client may reset the tunnel; nothing to handle */
      });
    });
    await new Promise<void>((resolve) => proxy.listen(0, '127.0.0.1', resolve));
    const { port } = proxy.address() as AddressInfo;
    const provider = new HttpProxyProvider({
      id: 'hp',
      url: `http://127.0.0.1:${port}`,
      timeoutMs: 5000,
    });
    try {
      const result = await provider.request({
        url: new URL('http://any-target.example/'),
        method: 'GET',
      });
      expect(result.body).toBe('<html>via-proxy</html>');
      expect(sawRequest).toBe(true);
    } finally {
      await provider.close();
      await new Promise((resolve) => proxy.close(resolve));
    }
  });
});

/* ------------------------------------------------------------------ */
/* A minimal SOCKS5 proxy for the SocksProxyProvider happy path        */
/* ------------------------------------------------------------------ */

const SOCKS_HTTP_RESPONSE =
  'HTTP/1.1 200 OK\r\nContent-Type: text/html\r\nContent-Length: 15\r\nConnection: close\r\n\r\n<html>ok</html>';

function startSocks5Proxy(): Promise<{ port: number }> {
  return new Promise((resolve, reject) => {
    const server = net.createServer((socket) => {
      let buf = Buffer.alloc(0);
      let stage: 'greeting' | 'connect' | 'tunnel' | 'done' = 'greeting';

      const tunnelRespond = (): void => {
        if (stage !== 'tunnel') return;
        stage = 'done';
        socket.write(SOCKS_HTTP_RESPONSE, () => socket.end());
      };

      socket.on('data', (chunk) => {
        if (stage === 'tunnel') {
          tunnelRespond();
          return;
        }
        buf = Buffer.concat([buf, chunk]);
        if (stage === 'greeting' && buf.length >= 2 && buf[0] === 0x05) {
          // SOCKS5 greeting: [05][nmethods][methods...]
          const nmethods = buf.readUInt8(1);
          if (buf.length < 2 + nmethods) return;
          socket.write(Buffer.from([0x05, 0x00]));
          buf = buf.subarray(2 + nmethods);
          stage = 'connect';
        }
        if (
          stage === 'connect' &&
          buf.length >= 4 &&
          buf[0] === 0x05 &&
          buf[1] === 0x01 &&
          buf[2] === 0x00
        ) {
          const atyp = buf.readUInt8(3);
          let headerLen = 0;
          if (atyp === 0x01) headerLen = 10;
          else if (atyp === 0x03) headerLen = 7 + buf.readUInt8(4);
          else if (atyp === 0x04) headerLen = 22;
          if (headerLen === 0 || buf.length < headerLen) return;
          socket.write(Buffer.from([0x05, 0x00, 0x00, 0x01, 0, 0, 0, 0, 0, 0]));
          buf = buf.subarray(headerLen);
          stage = 'tunnel';
          // The HTTP request through the tunnel may already be in the buffer;
          // otherwise the next data event is the tunneled request.
          if (buf.length > 0) tunnelRespond();
        }
      });
      socket.on('error', () => {
        /* the client may reset the tunnel; nothing to handle */
      });
    });
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.removeListener('error', reject);
      const { port } = server.address() as AddressInfo;
      resolve({ port });
    });
  });
}

describe('SocksProxyProvider', () => {
  it('tunnels through a socks5 proxy', async () => {
    const { port } = await startSocks5Proxy();
    const provider = new SocksProxyProvider({
      id: 'socks',
      url: `socks5://127.0.0.1:${port}`,
      timeoutMs: 3000,
    });
    try {
      const result = await provider.request({
        url: new URL('http://example.com/price'),
        method: 'GET',
      });
      expect(result.body).toBe('<html>ok</html>');
      expect(result.providerId).toBe('socks');
    } finally {
      await provider.close();
    }
  });

  it('wraps proxy failures in EgressRequestError', async () => {
    const provider = new SocksProxyProvider({
      id: 'socks-bad',
      url: 'socks5://127.0.0.1:1',
      timeoutMs: 1500,
    });
    await expect(
      provider.request({ url: new URL('http://example.com/price'), method: 'GET' }),
    ).rejects.toBeInstanceOf(EgressRequestError);
    await provider.close();
  });
});

/* ------------------------------------------------------------------ */
/* Provider registry                                                   */
/* ------------------------------------------------------------------ */

describe('ProviderRegistry', () => {
  it('creates every built-in provider type', () => {
    const registry = createProviderRegistry();
    expect(registry.types().sort()).toEqual([
      'cloudflare-worker',
      'direct',
      'http-proxy',
      'socks',
      'unlocker-api',
    ]);

    const direct = registry.create(
      { type: 'direct', id: 'a', weight: 2, capabilities: {}, geo: ['in'] },
      { timeoutMs: 1000 },
    );
    expect(direct).toBeInstanceOf(DirectProvider);
    expect(direct.weight).toBe(2);

    const httpProxy = registry.create(
      { type: 'http-proxy', id: 'b', url: 'http://127.0.0.1:1', weight: 1, capabilities: {} },
      { timeoutMs: 1000 },
    );
    expect(httpProxy).toBeInstanceOf(HttpProxyProvider);

    const socks = registry.create(
      { type: 'socks', id: 'c', url: 'socks5://127.0.0.1:1', weight: 1, capabilities: {} },
      { timeoutMs: 1000 },
    );
    expect(socks).toBeInstanceOf(SocksProxyProvider);

    const withSecret = registry.create(
      {
        type: 'cloudflare-worker',
        id: 'd',
        url: 'https://worker.example/fetch',
        secret: 's3cret',
        weight: 1,
        capabilities: {},
      },
      { timeoutMs: 1000 },
    );
    expect(withSecret).toBeInstanceOf(CloudflareWorkerProvider);

    const unlocker = registry.create(
      {
        type: 'unlocker-api',
        id: 'e',
        url: 'https://unlocker.example/api',
        method: 'GET',
        urlParam: 'url',
        authHeader: 'Authorization',
        authValue: 'x',
        extraParams: { country: 'in' },
        weight: 1,
        capabilities: {},
      },
      { timeoutMs: 1000 },
    );
    expect(unlocker).toBeInstanceOf(UnlockerApiProvider);
  });

  it('rejects unknown types and duplicate registration', () => {
    const registry = new ProviderRegistry();
    expect(() =>
      registry.create({ type: 'direct', id: 'x', weight: 1, capabilities: {} }, { timeoutMs: 1 }),
    ).toThrow(/Unknown egress provider type/);
    const other = createProviderRegistry();
    expect(() => {
      other.register('direct', (config) => new DirectProvider({ id: config.id }));
    }).toThrow(/Duplicate egress provider type registered/);
  });
});

/* ------------------------------------------------------------------ */
/* performUndiciRequest dispatcher + POST branches                     */
/* ------------------------------------------------------------------ */

describe('performUndiciRequest', () => {
  it('accepts an explicit dispatcher and posts a body', async () => {
    const local = new MockAgent();
    local.disableNetConnect();
    const pool = local.get('https://post.example');
    pool
      .intercept({ path: '/', method: 'POST', headers: { 'content-type': 'application/json' } })
      .reply(200, '{"posted":true}', { headers: { 'content-type': 'application/json' } });

    const dispatcher: Dispatcher = local;
    const result = await performUndiciRequest({
      url: new URL('https://post.example/'),
      method: 'POST',
      body: '{"posted":true}',
      headers: { 'content-type': 'application/json' },
      timeoutMs: 1000,
      dispatcher,
    });
    expect(result.status).toBe(200);
    expect(result.headers['content-type']).toBe('application/json');
    await local.close();
  });

  it('follows 3xx redirects to the final response', async () => {
    const local = new MockAgent();
    local.disableNetConnect();
    const pool = local.get('https://redir.example');
    pool
      .intercept({ path: '/start', method: 'GET' })
      .reply(302, 'redirecting', { headers: { location: 'https://redir.example/final' } });
    pool.intercept({ path: '/final', method: 'GET' }).reply(200, 'landed');

    const result = await performUndiciRequest({
      url: new URL('https://redir.example/start'),
      method: 'GET',
      timeoutMs: 1000,
      dispatcher: local,
    });
    expect(result.status).toBe(200);
    expect(result.body).toBe('landed');
    await local.close();
  });
});

describe('provider round-trips', () => {
  it('exposes provider ids on every response', async () => {
    mockAgent
      .get('https://roundtrip.example')
      .intercept({ path: '/', method: 'GET' })
      .reply(200, 'ok');
    const provider = new DirectProvider({ id: 'roundtrip' });
    const result = await provider.request({
      url: new URL('https://roundtrip.example/'),
      method: 'GET',
    });
    expect(result.providerId).toBe('roundtrip');
    expect(result.body).toBe('ok');
    expect(okResponse('x').providerId).toBe('x');
  });
});
