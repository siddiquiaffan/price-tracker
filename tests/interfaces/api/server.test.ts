import { describe, expect, it, vi } from 'vitest';
import { type Bot } from 'grammy';
import { Money } from '../../../src/core/entities/money.js';
import { TrackingService } from '../../../src/core/services/tracking-service.js';
import { StoreResolver } from '../../../src/core/services/store-resolver.js';
import { UrlResolver } from '../../../src/core/services/url-resolver.js';
import { InMemoryStoreRegistry } from '../../../src/stores/registry.js';
import { createApiServer } from '../../../src/interfaces/api/server.js';
import { FakeClock } from '../../helpers/clock.js';
import { FakeFetcher } from '../../helpers/fetcher.js';
import { FakeStore } from '../../helpers/fake-store.js';
import { CapturingLogger } from '../../helpers/logger.js';
import { createMemoryBundle } from '../../helpers/repositories.js';

const PRODUCT_URL = 'https://www.amazon.in/dp/B00EXAMPLE';
const API_KEY = 'test-api-key';
const AUTH = { authorization: `Bearer ${API_KEY}` };
const JSON_REQUEST = { 'content-type': 'application/json' };

interface Suite {
  bundle: ReturnType<typeof createMemoryBundle>;
  service: TrackingService;
  store: FakeStore;
}

function setup(): Suite {
  const bundle = createMemoryBundle();
  const store = new FakeStore({ id: 'amazon', name: 'Amazon', hosts: ['amazon.in'] });
  const registry = new InMemoryStoreRegistry();
  registry.register(store);
  const fetcher = new FakeFetcher();
  let idCounter = 0;
  const service = new TrackingService({
    storeResolver: new StoreResolver(registry),
    urlResolver: new UrlResolver({ fetcher, isProductUrl: () => true }),
    fetcher,
    products: bundle.products,
    trackings: bundle.trackings,
    users: bundle.users,
    clock: new FakeClock(),
    logger: new CapturingLogger(),
    limit: 5,
    trackingIdFactory: () => `trk-${(idCounter += 1)}`,
  });
  return { bundle, service, store };
}

function seedProduct(store: FakeStore, price = Money.fromMinorUnits(1299900)): void {
  store.script(PRODUCT_URL, {
    ok: true,
    data: {
      storeId: 'amazon',
      productId: 'B00EXAMPLE',
      url: PRODUCT_URL,
      title: 'Example Product',
      price,
      imageUrl: 'https://images.example.com/img.jpg',
      availability: 'in_stock',
    },
  });
}

function makeApp(suite: Suite, options: { apiKey?: string; bot?: Bot; webhookPath?: string } = {}) {
  return createApiServer({
    apiKey: options.apiKey ?? API_KEY,
    logger: new CapturingLogger(),
    trackingService: suite.service,
    users: suite.bundle.users,
    ...(options.bot !== undefined ? { bot: options.bot } : {}),
    ...(options.webhookPath !== undefined ? { webhookPath: options.webhookPath } : {}),
  });
}

/** Minimal grammY-shaped stub used to exercise the /setup and /bot routes. */
function fakeBot(): { bot: Bot; setWebhook: ReturnType<typeof vi.fn> } {
  const setWebhook = vi.fn(() => Promise.resolve(true));
  const bot = {
    isRunning: () => false,
    init: () => Promise.resolve(),
    handleUpdate: () => Promise.resolve(),
    api: { setWebhook },
  } as unknown as Bot;
  return { bot, setWebhook };
}

describe('API server auth (A3: API_KEY on every route but /bot)', () => {
  it('rejects every route with a missing key', async () => {
    const app = makeApp(setup());
    const getPaths = ['/', '/stats', '/info', '/setup'] as const;
    for (const path of getPaths) {
      const res = await app.request(path);
      expect(res.status, path).toBe(401);
      expect(await res.json()).toEqual({ error: 'Invalid API key' });
    }
    const post = await app.request('/', { method: 'POST', headers: JSON_REQUEST, body: '{}' });
    expect(post.status).toBe(401);
    const del = await app.request('/', { method: 'DELETE', headers: JSON_REQUEST, body: '{}' });
    expect(del.status).toBe(401);
  });

  it('rejects a wrong key', async () => {
    const app = makeApp(setup());
    const res = await app.request('/stats', { headers: { authorization: 'Bearer nope' } });
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: 'Invalid API key' });
  });

  it('does not register /bot without a bot, and keeps it unauthenticated with one', async () => {
    const withoutBot = makeApp(setup());
    const missing = await withoutBot.request('/bot', {
      method: 'POST',
      headers: JSON_REQUEST,
      body: '{}',
    });
    expect(missing.status).toBe(404);

    const suite = setup();
    const { bot } = fakeBot();
    const app = makeApp(suite, { bot });
    // No bearer token must NOT trigger the API-key guard (A3).
    const res = await app.request('/bot', {
      method: 'POST',
      headers: JSON_REQUEST,
      body: '{}',
    });
    expect(res.status).not.toBe(401);
  });
});

describe('GET /healthz (A9: unauthenticated liveness probe)', () => {
  it('answers ok without an API key', async () => {
    const app = makeApp(setup());
    const res = await app.request('/healthz');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });
});

describe('GET /', () => {
  it('lists a user trackings as legacy-shaped tasks documents', async () => {
    const suite = setup();
    seedProduct(suite.store);
    await suite.service.track(42, PRODUCT_URL);
    const app = makeApp(suite);

    const res = await app.request('/?userId=42', { headers: AUTH });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; result: Record<string, unknown>[] };
    expect(body.ok).toBe(true);
    expect(body.result).toHaveLength(1);
    expect(body.result[0]).toMatchObject({
      tracking_id: 'trk-1',
      userId: 42,
      merchant: 'amazon',
      title: 'Example Product',
      link: PRODUCT_URL,
      initPrice: '12999.00',
      price: '12999.00',
      image: 'https://images.example.com/img.jpg',
      availability: 'in_stock',
      lastCheckedAt: null,
    });
    expect(body.result[0]?.users).toEqual([{ userId: 42, tracking_id: 'trk-1' }]);
  });

  it('only returns the requesting user documents', async () => {
    const suite = setup();
    seedProduct(suite.store);
    await suite.service.track(42, PRODUCT_URL);
    await suite.service.track(7, PRODUCT_URL);
    const app = makeApp(suite);

    const res = await app.request('/?userId=7', { headers: AUTH });
    const body = (await res.json()) as { result: Record<string, unknown>[] };
    expect(body.result).toHaveLength(1);
    expect(body.result[0]?.userId).toBe(7);
  });

  it('rejects a missing or invalid userId', async () => {
    const app = makeApp(setup());
    for (const query of ['', '?userId=abc', '?userId=42.5', '?userId=0']) {
      const res = await app.request(`/${query}`, { headers: AUTH });
      expect(res.status, query).toBe(500);
      expect(await res.json()).toEqual({ error: 'Please pass a valid user id.' });
    }
  });
});

describe('POST /', () => {
  it('tracks a product and registers the user with email', async () => {
    const suite = setup();
    seedProduct(suite.store);
    const app = makeApp(suite);

    const res = await app.request('/', {
      method: 'POST',
      headers: { ...AUTH, ...JSON_REQUEST },
      body: JSON.stringify({ url: PRODUCT_URL, userId: 42, email: 'user@example.com' }),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, tracking_id: 'trk-1' });

    const user = await suite.bundle.users.findById(42);
    expect(user).toMatchObject({ id: 42, name: '42', mail: 'user@example.com' });
  });

  it('keeps an existing user name when the id already exists', async () => {
    const suite = setup();
    seedProduct(suite.store);
    await suite.bundle.users.upsert({ id: 42, name: 'Alice', mail: 'alice@example.com' });
    const app = makeApp(suite);

    const res = await app.request('/', {
      method: 'POST',
      headers: { ...AUTH, ...JSON_REQUEST },
      body: JSON.stringify({ url: PRODUCT_URL, userId: 42 }),
    });
    expect(res.status).toBe(200);
    const user = await suite.bundle.users.findById(42);
    expect(user?.name).toBe('Alice');
  });

  it('returns 503 when url or userId is missing/incorrect', async () => {
    const app = makeApp(setup());
    const bodies = [
      { userId: 42 },
      { url: PRODUCT_URL },
      { url: PRODUCT_URL, userId: 'x' },
      { url: PRODUCT_URL, userId: 4.2 },
    ];
    for (const body of bodies) {
      const res = await app.request('/', {
        method: 'POST',
        headers: { ...AUTH, ...JSON_REQUEST },
        body: JSON.stringify(body),
      });
      expect(res.status, JSON.stringify(body)).toBe(503);
      expect(await res.json()).toEqual({ error: 'Either url or userId is missing/incorrect' });
    }
  });

  it('returns 503 for a body that is not JSON', async () => {
    const app = makeApp(setup());
    const res = await app.request('/', {
      method: 'POST',
      headers: { ...AUTH, ...JSON_REQUEST },
      body: 'not-json',
    });
    expect(res.status).toBe(503);
  });

  it('fails with the generic message on invalid/unsupported/parsing errors', async () => {
    const suite = setup();
    const app = makeApp(suite);
    const request = (url: string) =>
      app.request('/', {
        method: 'POST',
        headers: { ...AUTH, ...JSON_REQUEST },
        body: JSON.stringify({ url, userId: 42 }),
      });

    // Unsupported store.
    const unsupported = await request('https://www.snapdeal.com/product/123');
    expect(unsupported.status).toBe(500);
    expect(await unsupported.json()).toEqual({
      error: 'Failed to add product to tracking list',
    });

    // Invalid URL (fails to parse -> InvalidUrlError).
    const invalid = await request('https://');
    expect(invalid.status).toBe(500);
    const body = (await invalid.json()) as { error: string };
    expect(body.error).toBe('Failed to add product to tracking list');

    // Scripted parse failure.
    suite.store.script(PRODUCT_URL, { ok: false, error: 'parse' });
    const parse = await request(PRODUCT_URL);
    expect(parse.status).toBe(500);
    expect(await parse.json()).toEqual({ error: 'Failed to add product to tracking list' });
  });

  it('exposes the user-facing message for retryable scrape failures', async () => {
    const suite = setup();
    suite.store.script(PRODUCT_URL, { ok: false, error: 'scrape' });
    const app = makeApp(suite);

    const res = await app.request('/', {
      method: 'POST',
      headers: { ...AUTH, ...JSON_REQUEST },
      body: JSON.stringify({ url: PRODUCT_URL, userId: 42 }),
    });
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "Sorry, I couldn't reach the store right now." });
  });
});

describe('DELETE /', () => {
  it('removes a tracking for the matched user', async () => {
    const suite = setup();
    seedProduct(suite.store);
    await suite.service.track(42, PRODUCT_URL);
    const app = makeApp(suite);

    const res = await app.request('/', {
      method: 'DELETE',
      headers: { ...AUTH, ...JSON_REQUEST },
      body: JSON.stringify({ tracking_id: 'trk-1', userId: 42 }),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(await suite.service.count(42)).toBe(0);
  });

  it('returns 503 for missing or unmatched ids', async () => {
    const suite = setup();
    seedProduct(suite.store);
    await suite.service.track(42, PRODUCT_URL);
    const app = makeApp(suite);

    const bodies = [
      { userId: 42 },
      { tracking_id: 'trk-1' },
      { tracking_id: 'nope', userId: 42 },
      { tracking_id: 'trk-1', userId: 7 },
    ];
    for (const body of bodies) {
      const res = await app.request('/', {
        method: 'DELETE',
        headers: { ...AUTH, ...JSON_REQUEST },
        body: JSON.stringify(body),
      });
      expect(res.status, JSON.stringify(body)).toBe(503);
      expect(await res.json()).toEqual({
        error: 'Either tracking_id or userId is incorrect/missing.',
      });
    }
  });
});

describe('GET /stats and GET /info', () => {
  it('returns user and tracking totals', async () => {
    const suite = setup();
    seedProduct(suite.store);
    const app = makeApp(suite);
    for (const userId of [42, 7]) {
      await app.request('/', {
        method: 'POST',
        headers: { ...AUTH, ...JSON_REQUEST },
        body: JSON.stringify({ url: PRODUCT_URL, userId }),
      });
    }

    const res = await app.request('/stats', { headers: AUTH });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ users: 2, products: 2 });
  });

  it('lists users with trimmed mail, omitting empty mail', async () => {
    const suite = setup();
    await suite.bundle.users.upsert({ id: 9, name: 'Alice', mail: '  alice@example.com  ' });
    await suite.bundle.users.upsert({ id: 10, name: 'Bob', mail: null });
    const app = makeApp(suite);

    const res = await app.request('/info', { headers: AUTH });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([
      { id: 9, name: 'Alice', mail: 'alice@example.com' },
      { id: 10, name: 'Bob' },
    ]);
  });
});

describe('GET /setup (A7: webhook host from request)', () => {
  it('returns error text without a bot', async () => {
    const app = makeApp(setup());
    const res = await app.request('/setup', { headers: AUTH });
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('error');
  });

  it('points the bot at https://<host>/bot and returns ok', async () => {
    const suite = setup();
    const { bot, setWebhook } = fakeBot();
    const app = makeApp(suite, { bot });

    const res = await app.request('/setup', {
      headers: { ...AUTH, host: 'tracker.example.com' },
    });
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('ok');
    expect(setWebhook).toHaveBeenCalledWith('https://tracker.example.com/bot');
  });

  it('honours a custom webhookPath', async () => {
    const suite = setup();
    const { bot, setWebhook } = fakeBot();
    const app = makeApp(suite, { bot, webhookPath: '/tg/webhook' });

    await app.request('/setup', { headers: { ...AUTH, host: 'tracker.example.com' } });
    expect(setWebhook).toHaveBeenCalledWith('https://tracker.example.com/tg/webhook');
  });
});
