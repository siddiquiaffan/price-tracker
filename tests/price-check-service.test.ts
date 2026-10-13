import { describe, expect, it } from 'vitest';
import { Money } from '../src/core/entities/money.js';
import { productDataFrom } from '../src/core/entities/product.js';
import { PriceCheckService } from '../src/core/services/price-check-service.js';
import { createNotificationStrategy } from '../src/core/services/notification-strategy.js';
import { StoreResolver } from '../src/core/services/store-resolver.js';
import { InMemoryStoreRegistry } from '../src/stores/registry.js';
import { type PriceChangeEvent, type PriceNotifier } from '../src/core/ports/notifier.js';
import { FakeClock } from './helpers/clock.js';
import { FakeStore } from './helpers/fake-store.js';
import { FakeFetcher } from './helpers/fetcher.js';
import { CapturingLogger } from './helpers/logger.js';
import { createMemoryBundle } from './helpers/repositories.js';

const PRODUCT_URL = 'https://www.amazon.in/dp/B00EXAMPLE';
const PRICE = Money.fromMinorUnits(129900);

class RecordingNotifier implements PriceNotifier {
  events: PriceChangeEvent[] = [];
  notify(event: PriceChangeEvent): Promise<void> {
    this.events.push(event);
    return Promise.resolve();
  }
}

async function setup(
  options: {
    strategy?: 'every-change' | 'only-drop' | 'threshold';
    thresholdPercent?: number;
  } = {},
) {
  const bundle = createMemoryBundle();
  const store = new FakeStore({ id: 'amazon', name: 'Amazon', hosts: ['amazon.in'] });
  const registry = new InMemoryStoreRegistry();
  registry.register(store);
  const storeResolver = new StoreResolver(registry);
  const fetcher = new FakeFetcher();
  const clock = new FakeClock();
  const notifier = new RecordingNotifier();
  const logger = new CapturingLogger();
  const priceCheck = new PriceCheckService({
    storeResolver,
    fetcher,
    products: bundle.products,
    trackings: bundle.trackings,
    snapshots: bundle.snapshots,
    priceNotifier: notifier,
    strategy: createNotificationStrategy(
      options.strategy ?? 'every-change',
      options.thresholdPercent,
    ),
    clock,
    logger,
  });

  // Seed a product and a subscriber.
  const product = await bundle.products.upsert(
    productDataFrom({
      storeId: 'amazon',
      productId: 'B00EXAMPLE',
      url: PRODUCT_URL,
      title: 'Example Product',
      price: PRICE,
      imageUrl: null,
      availability: 'in_stock',
    }),
    clock.now(),
  );
  await bundle.trackings.addTracking({
    data: {
      storeId: 'amazon',
      productId: 'B00EXAMPLE',
      url: PRODUCT_URL,
      title: 'Example Product',
      price: PRICE,
      imageUrl: null,
      availability: 'in_stock',
    },
    userId: 42,
    trackingId: 'trk-1',
    now: clock.now(),
  });

  return { bundle, store, priceCheck, notifier, clock, product };
}

function scriptPrice(
  store: FakeStore,
  price: Money | null,
  availability: 'in_stock' | 'out_of_stock' = 'in_stock',
): void {
  store.script(PRODUCT_URL, {
    ok: true,
    data: {
      storeId: 'amazon',
      productId: 'B00EXAMPLE',
      url: PRODUCT_URL,
      title: 'Example Product',
      price,
      imageUrl: null,
      availability,
    },
  });
}

describe('PriceCheckService', () => {
  it('notifies and snapshots on a price drop', async () => {
    const { priceCheck, notifier, bundle, clock, store } = await setup();
    scriptPrice(store, Money.fromMinorUnits(119900));

    clock.advance(3_600_000);
    const result = await priceCheck.checkProduct((await bundle.products.listAll())[0]!);

    expect(result.changed).toBe(true);
    expect(result.newPrice?.minorUnits).toBe(119900);
    expect(result.notified).toBe(1);
    expect(notifier.events).toHaveLength(1);
    expect(notifier.events[0]?.userId).toBe(42);
    expect(notifier.events[0]?.newPrice?.minorUnits).toBe(119900);

    const updated = await bundle.products.findByKey({ storeId: 'amazon', productId: 'B00EXAMPLE' });
    expect(updated?.currentPrice?.minorUnits).toBe(119900);
    const snapshots = await bundle.snapshots.listByProduct({
      storeId: 'amazon',
      productId: 'B00EXAMPLE',
    });
    expect(snapshots).toHaveLength(1);
    expect(snapshots[0]?.price?.minorUnits).toBe(119900);
  });

  it('does nothing when the price is unchanged', async () => {
    const { priceCheck, notifier, bundle, store } = await setup();
    scriptPrice(store, PRICE);

    const product = (await bundle.products.listAll())[0];
    expect(product).toBeDefined();
    const result = await priceCheck.checkProduct(product!);
    expect(result.changed).toBe(false);
    expect(result.notified).toBe(0);
    expect(notifier.events).toHaveLength(0);
    expect(
      await bundle.snapshots.listByProduct({ storeId: 'amazon', productId: 'B00EXAMPLE' }),
    ).toHaveLength(0);
  });

  it('notifies on an availability change even with the same price', async () => {
    const { priceCheck, bundle, store } = await setup();
    scriptPrice(store, PRICE, 'out_of_stock');

    const result = await priceCheck.checkProduct((await bundle.products.listAll())[0]!);
    expect(result.changed).toBe(true);
    expect(result.notified).toBe(1);
    const updated = await bundle.products.findByKey({ storeId: 'amazon', productId: 'B00EXAMPLE' });
    expect(updated?.availability).toBe('out_of_stock');
  });

  it('persists the snapshot but stays silent when the strategy says no', async () => {
    const { priceCheck, notifier, bundle, store } = await setup({ strategy: 'only-drop' });
    scriptPrice(store, Money.fromMinorUnits(139900)); // price rise

    const result = await priceCheck.checkProduct((await bundle.products.listAll())[0]!);
    expect(result.changed).toBe(true);
    expect(result.notified).toBe(0);
    expect(notifier.events).toHaveLength(0);
    // Snapshot policy is write-on-change, independent of notify policy (A5/A6).
    expect(
      await bundle.snapshots.listByProduct({ storeId: 'amazon', productId: 'B00EXAMPLE' }),
    ).toHaveLength(1);
  });

  it('survives a scrape failure and reports an unchanged base result', async () => {
    const { priceCheck, notifier, bundle, store } = await setup();
    store.script(PRODUCT_URL, { ok: false, error: 'scrape' });

    const result = await priceCheck.checkProduct((await bundle.products.listAll())[0]!);
    expect(result.changed).toBe(false);
    expect(result.notified).toBe(0);
    expect(notifier.events).toHaveLength(0);
    expect(
      await bundle.snapshots.listByProduct({ storeId: 'amazon', productId: 'B00EXAMPLE' }),
    ).toHaveLength(0);
  });

  it('checkAll aggregates checked, changed and notified counts', async () => {
    const { priceCheck, store, bundle } = await setup();
    scriptPrice(store, Money.fromMinorUnits(119900));

    const other = 'https://www.amazon.in/dp/B00OTHER';
    store.script(other, {
      ok: true,
      data: {
        storeId: 'amazon',
        productId: 'B00OTHER',
        url: other,
        title: 'Other',
        price: Money.fromMinorUnits(50000),
        imageUrl: null,
        availability: 'in_stock',
      },
    });
    await bundle.products.upsert(
      productDataFrom({
        storeId: 'amazon',
        productId: 'B00OTHER',
        url: other,
        title: 'Other',
        price: Money.fromMinorUnits(50000),
        imageUrl: null,
        availability: 'in_stock',
      }),
      new FakeClock().now(),
    );

    // Product B00EXAMPLE price changes to 119900; B00OTHER stays at its current price.
    const summary = await priceCheck.checkAll();
    expect(summary.checked).toBe(2);
    expect(summary.changed).toBe(1);
    expect(summary.notified).toBe(1);
    expect(summary.failed).toBe(0);
  });
});
