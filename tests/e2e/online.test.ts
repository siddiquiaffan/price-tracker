import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { loadEgressConfig } from '../../src/config/egress-config.js';
import { AllEgressFailedError } from '../../src/core/errors/app-error.js';
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
import { FlipkartBlockDetector } from '../../src/stores/flipkart/block-detector.js';
import { CapturingLogger } from '../helpers/logger.js';
import { createMemoryBundle } from '../helpers/repositories.js';

/**
 * Real-network e2e, one case per store. Runs only when `RUN_ONLINE_E2E=1` is
 * set (see `pnpm test:e2e:online` and `vitest.e2e.config.ts`); skipped
 * everywhere else so the offline suite never depends on the network or any
 * store's block rules.
 *
 * Every case scrapes a live product through the production pipeline — real
 * stores, real egress (`EGRESS_CONFIG`, else legacy `PROXY`/`WORKER_URL`, else
 * `direct`), real `EgressFetcher` — with in-memory persistence only.
 *
 * Which URLs run:
 * - `DEFAULT_CASES` below (one verified listing per store).
 * - Any store can be added or overridden without code changes via
 *   `ONLINE_E2E_URLS='{"flipkart":"https://..."}'` (inline JSON), or
 *   `ONLINE_E2E_URLS_FILE=tests/e2e/urls.json` (same JSON in a file — handy on
 *   Windows where inline env vars with quotes are awkward).
 * Overrides drop the exact `productId`/`canonicalUrl` expectations and assert
 * structurally instead (store routing, tracking-free canonical URL, non-empty
 * id/title, price > 0), so any live product URL of a registered store works.
 *
 * Egress availability blips are retried (`MAX_LIVE_ATTEMPTS`) because bot-hostile
 * stores like Flipkart intermittently serve captcha pages to plain IPs, which
 * the block detector correctly treats as a failed provider. Functional failures
 * (parse errors, failed assertions) are never retried.
 */
interface LiveProductCase {
  /** Human-readable label used in the test name. */
  name: string;
  /** Store id the URL must resolve to (e.g. 'amazon', 'flipkart'). */
  storeId: string;
  /** Live product URL to track (tracking params allowed). */
  url: string;
  /** Exact expected product id; only known for verified defaults. */
  productId?: string;
  /** Exact expected canonical (tracking-free) URL; only for verified defaults. */
  canonicalUrl?: string;
  /** Optional loose sanity check on the title. */
  titlePattern?: RegExp;
  /** Set when `ONLINE_E2E_URLS`/`ONLINE_E2E_URLS_FILE` is invalid. */
  configError?: string;
}

const DEFAULT_CASES: LiveProductCase[] = [
  {
    name: 'amazon',
    storeId: 'amazon',
    // A `/gp/product/<ASIN>` URL laden with tracking params that must
    // canonicalize to `/dp/<ASIN>` (OnePlus N6 Lite — the original live
    // listing used to build this suite).
    url: 'https://www.amazon.in/gp/product/B0HBPQJN54?aref=cvexgWf5N5&pd_rd_plhdr=t&pf_rd_r=QYCXX3Z448XAS7AX3HDB&th=1',
    productId: 'B0HBPQJN54',
    canonicalUrl: 'https://www.amazon.in/dp/B0HBPQJN54',
    titlePattern: /oneplus n6 lite/i,
  },
  {
    name: 'flipkart',
    storeId: 'flipkart',
    // A live Flipkart listing (vivo V80): real tracking params that must be
    // stripped. Flipkart canonicalizes to `product/p/itme?pid=<PID>`; the path
    // id (`itm...`) is ignored whenever a `pid` query parameter is present.
    url: 'https://www.flipkart.com/vivo-v80-sunrise-anthem-128-gb/p/itma504af1ae77cb?pid=MOBHR8J2FRP7VRYG&marketplace=FLIPKART&lid=LSTMOBHR8J2FRP7VRYGEZGPBS&ctx=eyJjYXJkQ29udGV4dCI6eyJhdHRyaWJ1dGVzIjp7InNvdXJjZUNvbnRlbnRUeXBlIjp7InNpbmdsZVZhbHVlQXR0cmlidXRlIjp7ImtleSI6InNvdXJjZUNvbnRlbnRUeXBlIiwiaW5mZXJlbmNlVHlwZSI6IlNDVCIsInZhbHVlIjoiQUQiLCJ2YWx1ZVR5cGUiOiJTSU5HTEVfVkFMVUVEIn19fX19&nnc=792QGIOFFZKM_AD&pageUID=1791898856890',
    productId: 'MOBHR8J2FRP7VRYG',
    canonicalUrl: 'https://www.flipkart.com/product/p/itme?pid=MOBHR8J2FRP7VRYG',
    titlePattern: /vivo v80/i,
  },
];

const runOnline = process.env.RUN_ONLINE_E2E === '1';

/** Egress-availability blips are retried; functional errors fail hard. */
const MAX_LIVE_ATTEMPTS = 3;

function retryableEgressError(error: unknown): error is AllEgressFailedError {
  return error instanceof AllEgressFailedError;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Read the optional store->URL override map (env inline or a JSON file). */
function readOverrides(): Record<string, string> | null {
  const inline = process.env.ONLINE_E2E_URLS?.trim();
  const filePath = process.env.ONLINE_E2E_URLS_FILE?.trim();

  let source: string;
  let content: string;
  if (inline) {
    source = 'ONLINE_E2E_URLS';
    content = inline;
  } else if (filePath) {
    source = `ONLINE_E2E_URLS_FILE (${filePath})`;
    try {
      content = readFileSync(filePath, 'utf8');
    } catch (error) {
      throw new Error(
        `Cannot read ${source}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  } else {
    return null;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(content) as unknown;
  } catch (error) {
    throw new Error(
      `${source} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error(`${source} must be a JSON object mapping storeId -> product URL`);
  }

  const overrides: Record<string, string> = {};
  for (const [storeId, value] of Object.entries(parsed)) {
    if (typeof value !== 'string' || value.trim().length === 0) {
      throw new Error(`${source}: entry "${storeId}" must be a non-empty URL string`);
    }
    overrides[storeId] = value.trim();
  }
  return overrides;
}

/** DEFAULT_CASES, with any `ONLINE_E2E_URLS`/`ONLINE_E2E_URLS_FILE` merged in.
 *  Never throws at collection time: a bad override becomes a failing case. */
function resolveCases(): LiveProductCase[] {
  const cases: LiveProductCase[] = DEFAULT_CASES.map((tc) => ({ ...tc }));
  try {
    const overrides = readOverrides();
    if (!overrides) return cases;
    for (const [storeId, url] of Object.entries(overrides)) {
      const next: LiveProductCase = { name: `${storeId} (override)`, storeId, url };
      const existing = cases.findIndex((tc) => tc.storeId === storeId);
      if (existing !== -1) {
        cases[existing] = next;
      } else {
        cases.push(next);
      }
    }
    return cases;
  } catch (error) {
    return [
      {
        name: 'invalid online e2e configuration',
        storeId: 'invalid',
        url: process.env.ONLINE_E2E_URLS ?? process.env.ONLINE_E2E_URLS_FILE ?? '',
        configError: error instanceof Error ? error.message : String(error),
      },
    ];
  }
}

class RecordingNotifier implements PriceNotifier {
  events: PriceChangeEvent[] = [];
  notify(event: PriceChangeEvent): Promise<void> {
    this.events.push(event);
    return Promise.resolve();
  }
}

async function runLiveScrape(tc: LiveProductCase): Promise<void> {
  const timeoutMs = Number(process.env.REQUEST_TIMEOUT_MS ?? 60_000);
  const logger = new CapturingLogger();
  // Production wiring: one detector shared by stores AND egress pools, with
  // Flipkart's retry/challenge-page rule registered (see app.ts).
  const blockDetector = new CompositeBlockDetector();
  blockDetector.register('flipkart', new FlipkartBlockDetector());
  const pools: EgressPoolRegistry = createPoolRegistry({
    config: loadEgressConfig({ env: process.env }),
    clock: new SystemClock(),
    logger,
    blockDetector,
    requestTimeoutMs: timeoutMs,
  });

  try {
    const fetcher = new EgressFetcher({ pools, logger, timeoutMs });
    const registry = createStoreRegistry({ blockDetector });
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

    const { product } = await trackingService.track(42, tc.url);

    // The owning store must route and parse the scrape.
    expect(product.storeId).toBe(tc.storeId);
    expect(product.productId.length).toBeGreaterThan(0);
    if (tc.productId) expect(product.productId).toBe(tc.productId);
    if (tc.canonicalUrl) expect(product.url).toBe(tc.canonicalUrl);
    expect(product.title.length).toBeGreaterThan(0);
    if (tc.titlePattern) expect(product.title).toMatch(tc.titlePattern);

    // Tracking params must be stripped: the stored URL is the store's own
    // canonical form of the input (idempotent `normalizeUrl`).
    const canonical = storeResolver
      .resolve(new URL(tc.url))
      .normalizeUrl(new URL(tc.url))
      .toString();
    expect(product.url).toBe(canonical);

    expect(['in_stock', 'out_of_stock', 'unknown']).toContain(product.availability);
    expect(product.currentPrice).not.toBeNull();
    const livePrice = product.currentPrice?.minorUnits;
    expect(livePrice).toBeGreaterThan(0);
    expect(notifier.events).toHaveLength(0);

    console.log(
      `[online e2e] ${tc.storeId} ${product.productId}: ${JSON.stringify({
        url: product.url,
        title: product.title,
        price: product.currentPrice,
        availability: product.availability,
      })}`,
    );

    // A second live scrape through the full check pipeline. A price cannot
    // realistically move between two requests seconds apart.
    const recheck = await priceCheck.checkProduct(product);
    expect(recheck.changed).toBe(false);
    expect(recheck.notified).toBe(0);
    expect(recheck.previousPrice?.minorUnits).toBe(livePrice);
    expect(recheck.newPrice?.minorUnits).toBe(livePrice);
    expect(notifier.events).toHaveLength(0);

    const snapshots = await bundle.snapshots.listByProduct({
      storeId: product.storeId,
      productId: product.productId,
    });
    expect(snapshots).toHaveLength(0);
  } finally {
    await pools.close();
  }
}

describe.runIf(runOnline)('e2e: live store scrapes (opt-in, real network)', () => {
  const cases = resolveCases();
  it.each(cases.map((tc) => [tc.name, tc] as [string, LiveProductCase]))(
    'tracks and re-checks %s (live)',
    async (_name, tc) => {
      if (tc.configError) throw new Error(`Invalid online e2e configuration: ${tc.configError}`);
      let lastError: unknown;
      for (let attempt = 1; attempt <= MAX_LIVE_ATTEMPTS; attempt += 1) {
        try {
          await runLiveScrape(tc);
          return;
        } catch (error) {
          lastError = error;
          if (attempt < MAX_LIVE_ATTEMPTS && retryableEgressError(error)) {
            const first = error.attempts[0];
            const reason = first ? first.reason : 'egress failure';
            const extra = error.attempts.length > 1 ? ` (+${error.attempts.length - 1} more)` : '';
            console.log(
              `[online e2e] ${tc.storeId}: attempt ${attempt}/${MAX_LIVE_ATTEMPTS} failed (${reason}${extra}); retrying…`,
            );
            await delay(1500);
            continue;
          }
          throw lastError;
        }
      }
      throw lastError;
    },
  );
});
