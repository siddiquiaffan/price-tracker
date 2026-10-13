import { describe, expect, it } from 'vitest';
import { loadEgressConfig } from '../../src/config/egress-config.js';
import { SystemClock } from '../../src/core/ports/clock.js';
import { type PriceChangeEvent, type PriceNotifier } from '../../src/core/ports/notifier.js';
import { PriceCheckService } from '../../src/core/services/price-check-service.js';
import { TrackingService } from '../../src/core/services/tracking-service.js';
import { StoreResolver } from '../../src/core/services/store-resolver.js';
import { UrlResolver } from '../../src/core/services/url-resolver.js';
import { createNotificationStrategy } from '../../src/core/services/notification-strategy.js';
import { createStoreRegistry } from '../../src/stores/index.js';
import { CompositeBlockDetector } from '../../src/infra/egress/block-detector.js';
import {
  createPoolRegistry,
  type EgressPoolRegistry,
} from '../../src/infra/egress/egress-pool-registry.js';
import { EgressFetcher } from '../../src/infra/http/fetcher.js';
import { CapturingLogger } from '../helpers/logger.js';
import { createMemoryBundle } from '../helpers/repositories.js';

/**
 * Real-network e2e. Runs only when `RUN_ONLINE_E2E=1` is set (see
 * `pnpm test:e2e:online` and `vitest.e2e.config.ts`); skipped everywhere else
 * so the offline suite never depends on the network or Amazon's block rules.
 *
 * The scrape is wired exactly like production: real stores, the real egress
 * layer (`EGRESS_CONFIG`, else legacy `PROXY`/`WORKER_URL`, else `direct`) and
 * the real `EgressFetcher` — only persistence is in-memory.
 */
const LIVE_URL =
  'https://www.amazon.in/gp/product/B0HBPQJN54?aref=cvexgWf5N5&pd_rd_plhdr=t&pf_rd_r=QYCXX3Z448XAS7AX3HDB&th=1';
const ASIN = 'B0HBPQJN54';

const runOnline = process.env.RUN_ONLINE_E2E === '1';

class RecordingNotifier implements PriceNotifier {
  events: PriceChangeEvent[] = [];
  notify(event: PriceChangeEvent): Promise<void> {
    this.events.push(event);
    return Promise.resolve();
  }
}

describe.runIf(runOnline)('e2e: live Amazon scrape (opt-in, real network)', () => {
  it('tracks the live URL, re-checks it, and parses a real price', async () => {
    const timeoutMs = Number(process.env.REQUEST_TIMEOUT_MS ?? 60_000);
    const logger = new CapturingLogger();

    const pools: EgressPoolRegistry = createPoolRegistry({
      config: loadEgressConfig({ env: process.env }),
      clock: new SystemClock(),
      logger,
      blockDetector: new CompositeBlockDetector(),
      requestTimeoutMs: timeoutMs,
    });

    try {
      const fetcher = new EgressFetcher({ pools, logger, timeoutMs });
      const registry = createStoreRegistry({ blockDetector: new CompositeBlockDetector() });
      const storeResolver = new StoreResolver(registry);
      const bundle = createMemoryBundle();
      const notifier = new RecordingNotifier();

      const trackingService = new TrackingService({
        storeResolver,
        urlResolver: new UrlResolver({ fetcher, isProductUrl: () => true }),
        fetcher,
        products: bundle.products,
        trackings: bundle.trackings,
        users: bundle.users,
        clock: new SystemClock(),
        logger,
        limit: 5,
        trackingIdFactory: () => 'live-1',
      });

      const priceCheck = new PriceCheckService({
        storeResolver,
        fetcher,
        products: bundle.products,
        trackings: bundle.trackings,
        snapshots: bundle.snapshots,
        priceNotifier: notifier,
        strategy: createNotificationStrategy('every-change', 0),
        clock: new SystemClock(),
        logger,
      });

      const { product } = await trackingService.track(42, LIVE_URL);

      console.log('=================================');
      console.log(product);
      console.log('=================================');

      // The query-param-laden URL must be canonicalized (ASIN extracted).
      expect(product.productId).toBe(ASIN);
      expect(product.storeId).toBe('amazon');
      expect(product.url).toBe('https://www.amazon.in/dp/B0HBPQJN54');
      expect(product.title.length).toBeGreaterThan(0);
      expect(['in_stock', 'out_of_stock', 'unknown']).toContain(product.availability);
      expect(product.currentPrice).not.toBeNull();
      const livePrice = product.currentPrice?.minorUnits;
      expect(livePrice).toBeGreaterThan(0);
      expect(notifier.events).toHaveLength(0);

      // A second live scrape through the full check pipeline. A price cannot
      // realistically move between two requests seconds apart.
      const recheck = await priceCheck.checkProduct(product);
      expect(recheck.changed).toBe(false);
      expect(recheck.notified).toBe(0);
      expect(recheck.previousPrice?.minorUnits).toBe(livePrice);
      expect(recheck.newPrice?.minorUnits).toBe(livePrice);
      expect(notifier.events).toHaveLength(0);

      const snapshots = await bundle.snapshots.listByProduct({
        storeId: 'amazon',
        productId: ASIN,
      });
      expect(snapshots).toHaveLength(0);
    } finally {
      await pools.close();
    }
  });
});
