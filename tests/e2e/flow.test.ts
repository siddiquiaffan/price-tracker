import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { egressConfigSchema } from '../../src/config/egress-config.js';
import { loadConfig } from '../../src/config/env.js';
import { LimitExceededError } from '../../src/core/errors/app-error.js';
import { type PriceChangeEvent, type PriceNotifier } from '../../src/core/ports/notifier.js';
import { PriceCheckService } from '../../src/core/services/price-check-service.js';
import { TrackingService } from '../../src/core/services/tracking-service.js';
import { StoreResolver } from '../../src/core/services/store-resolver.js';
import { UrlResolver } from '../../src/core/services/url-resolver.js';
import { createNotificationStrategy } from '../../src/core/services/notification-strategy.js';
import { createStoreRegistry } from '../../src/stores/index.js';
import { AmazonStore } from '../../src/stores/amazon/index.js';
import { CompositeBlockDetector } from '../../src/infra/egress/block-detector.js';
import { createPoolRegistry } from '../../src/infra/egress/egress-pool-registry.js';
import { ProviderRegistry } from '../../src/infra/egress/provider-registry.js';
import { type EgressResponse } from '../../src/infra/egress/egress-provider.interface.js';
import { EgressFetcher } from '../../src/infra/http/fetcher.js';
import { FakeClock } from '../helpers/clock.js';
import { FakeFetcher } from '../helpers/fetcher.js';
import { CapturingLogger } from '../helpers/logger.js';
import { createMemoryBundle } from '../helpers/repositories.js';

const PRODUCT_URL = 'https://www.amazon.in/dp/B00EXAMPLE';
const OTHER_URL = 'https://www.amazon.in/dp/B07EXAMPLE';

const here = dirname(fileURLToPath(import.meta.url));
const fixture = (store: 'amazon' | 'flipkart', name: string): string =>
  readFileSync(join(here, '..', 'fixtures', store, name), 'utf8');

class RecordingNotifier implements PriceNotifier {
  events: PriceChangeEvent[] = [];
  notify(event: PriceChangeEvent): Promise<void> {
    this.events.push(event);
    return Promise.resolve();
  }
}

interface Pipeline {
  fetcher: FakeFetcher;
  clock: FakeClock;
  trackingService: TrackingService;
  priceCheck: PriceCheckService;
  notifier: RecordingNotifier;
  bundle: ReturnType<typeof createMemoryBundle>;
}

/** A full offline pipeline: real Amazon store, memory repos, scripted fetch. */
function buildPipeline(limit = 5): Pipeline {
  const bundle = createMemoryBundle();
  const registry = createStoreRegistry({ blockDetector: new CompositeBlockDetector() });
  const storeResolver = new StoreResolver(registry);
  const fetcher = new FakeFetcher();
  const clock = new FakeClock();
  const notifier = new RecordingNotifier();
  const logger = new CapturingLogger();
  let idCounter = 0;
  const trackingService = new TrackingService({
    storeResolver,
    urlResolver: new UrlResolver({ fetcher, isProductUrl: () => true }),
    fetcher,
    products: bundle.products,
    trackings: bundle.trackings,
    users: bundle.users,
    clock,
    logger,
    limit,
    trackingIdFactory: () => `trk-${(idCounter += 1)}`,
  });
  const priceCheck = new PriceCheckService({
    storeResolver,
    fetcher,
    products: bundle.products,
    trackings: bundle.trackings,
    snapshots: bundle.snapshots,
    priceNotifier: notifier,
    strategy: createNotificationStrategy('every-change', 0),
    clock,
    logger,
  });
  return { fetcher, clock, trackingService, priceCheck, notifier, bundle };
}

describe('e2e: full lifecycle with the real Amazon store and fixtures (offline)', () => {
  it('track -> scrape -> change -> exactly one notification with the right old/new price', async () => {
    const { fetcher, clock, trackingService, priceCheck, notifier, bundle } = buildPipeline();
    // Fixture prices: in-stock-jsonld = ₹129,999.00, deal-price = ₹45,999.00.
    fetcher.when(PRODUCT_URL, { status: 200, body: fixture('amazon', 'in-stock-jsonld.html') });

    const { product } = await trackingService.track(42, PRODUCT_URL);
    expect(product.currentPrice?.minorUnits).toBe(12999900);
    expect(notifier.events).toHaveLength(0);

    // The product drops in price on the next check.
    fetcher.when(PRODUCT_URL, { status: 200, body: fixture('amazon', 'deal-price.html') });
    clock.advance(3_600_000);
    const result = await priceCheck.checkProduct(product);
    expect(result.changed).toBe(true);
    expect(result.previousPrice?.minorUnits).toBe(12999900);
    expect(result.newPrice?.minorUnits).toBe(4599900);
    expect(result.notified).toBe(1);

    expect(notifier.events).toHaveLength(1);
    const event = notifier.events[0]!;
    expect(event.userId).toBe(42);
    expect(event.trackingId).toBe('trk-1');
    expect(event.previousPrice?.minorUnits).toBe(12999900);
    expect(event.newPrice?.minorUnits).toBe(4599900);

    const updated = await bundle.products.findByKey({
      storeId: 'amazon',
      productId: 'B00EXAMPLE',
    });
    expect(updated?.currentPrice?.minorUnits).toBe(4599900);
    const snapshots = await bundle.snapshots.listByProduct({
      storeId: 'amazon',
      productId: 'B00EXAMPLE',
    });
    expect(snapshots).toHaveLength(1);

    // A re-check at the same price must not notify again (B11 fixed).
    clock.advance(3_600_000);
    const second = await priceCheck.checkProduct(updated!);
    expect(second.changed).toBe(false);
    expect(second.notified).toBe(0);
    expect(notifier.events).toHaveLength(1);
  });

  it('tracks two users and notifies both exactly once on a change', async () => {
    const { fetcher, clock, trackingService, priceCheck, notifier } = buildPipeline();
    fetcher.when(PRODUCT_URL, { status: 200, body: fixture('amazon', 'in-stock-jsonld.html') });
    await trackingService.track(42, PRODUCT_URL);
    await trackingService.track(7, PRODUCT_URL);

    fetcher.when(PRODUCT_URL, { status: 200, body: fixture('amazon', 'deal-price.html') });
    clock.advance(3_600_000);
    const result = await priceCheck.checkAll();
    expect(result.checked).toBe(1);
    expect(result.changed).toBe(1);
    expect(result.notified).toBe(2);
    expect(notifier.events.map((event) => event.userId).sort((a, b) => a - b)).toEqual([7, 42]);
  });

  it('enforces the tracking limit and frees the slot on /stop', async () => {
    const { fetcher, trackingService } = buildPipeline(1);
    fetcher.when(PRODUCT_URL, { status: 200, body: fixture('amazon', 'in-stock-jsonld.html') });
    fetcher.when(OTHER_URL, { status: 200, body: fixture('amazon', 'deal-price.html') });

    const first = await trackingService.track(42, PRODUCT_URL);
    await expect(trackingService.track(42, OTHER_URL)).rejects.toBeInstanceOf(LimitExceededError);

    expect(await trackingService.stop(42, first.tracking.trackingId)).toBe(true);
    const second = await trackingService.track(42, OTHER_URL);
    expect(second.added).toBe(true);
    expect(second.product.currentPrice?.minorUnits).toBe(4599900);
    expect(await trackingService.count(42)).toBe(1);
  });
});

describe('e2e: egress failover (first provider blocked, second succeeds)', () => {
  it('routes a request through the healthy provider and stores the block against the first', async () => {
    const registry = new ProviderRegistry();
    registry.register('direct', (config) => {
      const id = config.id;
      return {
        id,
        type: 'direct' as const,
        weight: 1,
        capabilities: {},
        request(): Promise<EgressResponse> {
          if (id === 'blocked-first') {
            return Promise.resolve({
              status: 200,
              headers: {},
              body: fixture('amazon', 'captcha.html'),
              providerId: id,
              latencyMs: 1,
            });
          }
          return Promise.resolve({
            status: 200,
            headers: {},
            body: fixture('amazon', 'in-stock-jsonld.html'),
            providerId: id,
            latencyMs: 1,
          });
        },
      };
    });

    const pools = createPoolRegistry({
      config: egressConfigSchema.parse({
        defaultPool: 'default',
        pools: {
          default: {
            strategy: 'round-robin',
            maxAttempts: 2,
            cooldown: { baseMs: 1000, maxMs: 5000 },
            providers: [
              { type: 'direct', id: 'blocked-first', weight: 1, capabilities: {} },
              { type: 'direct', id: 'good-second', weight: 1, capabilities: {} },
            ],
          },
        },
        storePolicy: {},
      }),
      clock: new FakeClock(),
      logger: new CapturingLogger(),
      blockDetector: new CompositeBlockDetector(),
      requestTimeoutMs: 5000,
      providerRegistry: registry,
    });

    const response = await pools
      .forStore('amazon')
      .request({ url: new URL(PRODUCT_URL), method: 'GET' });
    expect(response.providerId).toBe('good-second');

    const stats = pools.forStore('amazon').stats();
    const blocked = stats.find((entry) => entry.id === 'blocked-first');
    const good = stats.find((entry) => entry.id === 'good-second');
    expect(blocked).toMatchObject({ failures: 1, successes: 0 });
    expect(good).toMatchObject({ failures: 0, successes: 1 });

    // The full store scrape pipeline also succeeds through the egress fetcher.
    const fetcher = new EgressFetcher({ pools, logger: new CapturingLogger(), timeoutMs: 5000 });
    const store = new AmazonStore({ blockDetector: new CompositeBlockDetector() });
    const data = await store.fetchProduct(new URL(PRODUCT_URL), {
      fetcher,
      logger: new CapturingLogger(),
    });
    expect(data.productId).toBe('B00EXAMPLE');
    expect(data.price?.minorUnits).toBe(12999900);

    await pools.close();
  });
});

describe('e2e: legacy PROXY / WORKER_URL-only boot', () => {
  const baseEnv = {
    BOT_TOKEN: '123:dummy',
    API_KEY: 'test-key',
    DB_URL: 'mongodb://localhost:27017',
    ADMINS: '',
  };

  it('maps only legacy PROXY+WORKER_URL into an egress config', () => {
    const config = loadConfig({
      env: {
        ...baseEnv,
        PROXY: 'http://proxy.example.com:8080',
        WORKER_URL: 'https://worker.example.workers.dev/fetch',
      },
    });
    const providers = config.egress.pools.default?.providers ?? [];
    expect(providers).toEqual([
      expect.objectContaining({
        id: 'legacy-proxy',
        type: 'http-proxy',
        url: 'http://proxy.example.com:8080',
      }),
      expect.objectContaining({
        id: 'legacy-worker',
        type: 'cloudflare-worker',
        url: 'https://worker.example.workers.dev/fetch',
      }),
    ]);
  });

  it('prefers a socks5 proxy when PROXY uses the socks scheme', () => {
    const config = loadConfig({
      env: {
        ...baseEnv,
        PROXY: 'socks5://user:pass@proxy.example.com:1080',
      },
    });
    const providers = config.egress.pools.default?.providers ?? [];
    expect(providers).toHaveLength(1);
    expect(providers[0]).toMatchObject({ id: 'legacy-proxy', type: 'socks' });
  });

  it('gives EGRESS_CONFIG precedence over the legacy shims', () => {
    const config = loadConfig({
      env: {
        ...baseEnv,
        PROXY: 'http://legacy-proxy.example.com:8080',
        EGRESS_CONFIG: JSON.stringify({
          defaultPool: 'default',
          pools: {
            default: {
              strategy: 'round-robin',
              providers: [{ id: 'p1', type: 'direct', weight: 1, capabilities: {} }],
            },
          },
          storePolicy: {},
        }),
      },
    });
    const providers = config.egress.pools.default?.providers ?? [];
    expect(providers).toHaveLength(1);
    expect(providers[0]?.id).toBe('p1');
  });

  it('interpolates ${ENV_VAR} placeholders from the environment', () => {
    const config = loadConfig({
      env: {
        ...baseEnv,
        PROXY_HOST: 'http://secret-proxy.example.com:3128',
        EGRESS_CONFIG: JSON.stringify({
          defaultPool: 'default',
          pools: {
            default: {
              strategy: 'round-robin',
              providers: [{ id: 'p1', type: 'http-proxy', url: '${PROXY_HOST}' }],
            },
          },
          storePolicy: {},
        }),
      },
    });
    const providers = config.egress.pools.default?.providers ?? [];
    expect(providers).toHaveLength(1);
    const first = providers[0];
    expect(first?.type).toBe('http-proxy');
    if (first?.type === 'http-proxy') {
      expect(first.url).toBe('http://secret-proxy.example.com:3128');
    }
  });
});
