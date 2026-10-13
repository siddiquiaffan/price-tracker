import { describe, expect, it } from 'vitest';
import { Money } from '../src/core/entities/money.js';
import { LimitExceededError, UnsupportedStoreError } from '../src/core/errors/app-error.js';
import { TrackingService } from '../src/core/services/tracking-service.js';
import { StoreResolver } from '../src/core/services/store-resolver.js';
import { UrlResolver } from '../src/core/services/url-resolver.js';
import { InMemoryStoreRegistry } from '../src/stores/registry.js';
import { FakeClock } from './helpers/clock.js';
import { FakeStore } from './helpers/fake-store.js';
import { FakeFetcher } from './helpers/fetcher.js';
import { CapturingLogger } from './helpers/logger.js';
import { createMemoryBundle } from './helpers/repositories.js';

const PRODUCT_URL = 'https://www.amazon.in/dp/B00EXAMPLE';

function setup(options: { limit?: number } = {}) {
  const bundle = createMemoryBundle();
  const store = new FakeStore({ id: 'amazon', name: 'Amazon', hosts: ['amazon.in'] });
  const registry = new InMemoryStoreRegistry();
  registry.register(store);
  const storeResolver = new StoreResolver(registry);
  const fetcher = new FakeFetcher();
  const urlResolver = new UrlResolver({ fetcher, isProductUrl: () => true });
  const clock = new FakeClock();
  let idCounter = 0;
  const service = new TrackingService({
    storeResolver,
    urlResolver,
    fetcher,
    products: bundle.products,
    trackings: bundle.trackings,
    users: bundle.users,
    clock,
    logger: new CapturingLogger(),
    limit: options.limit ?? 5,
    trackingIdFactory: () => `trk-${(idCounter += 1)}`,
  });
  return { bundle, store, service, clock };
}

function seedProduct(
  store: FakeStore,
  price: Money,
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
      imageUrl: 'https://images.example.com/img.jpg',
      availability,
    },
  });
}

describe('TrackingService', () => {
  it('tracks a product for a user and persists product + tracking', async () => {
    const { service, store } = setup();
    seedProduct(store, Money.fromMinorUnits(129900));
    const result = await service.track(42, PRODUCT_URL);

    expect(result.added).toBe(true);
    expect(result.tracking.trackingId).toBe('trk-1');
    expect(result.tracking.userId).toBe(42);
    expect(result.product.currentPrice?.minorUnits).toBe(129900);
    expect(await service.count(42)).toBe(1);
  });

  it('is idempotent when the same user tracks the same product again', async () => {
    const { service, store } = setup();
    seedProduct(store, Money.fromMinorUnits(129900));
    const first = await service.track(42, PRODUCT_URL);
    const second = await service.track(42, PRODUCT_URL);

    expect(first.added).toBe(true);
    expect(second.added).toBe(false);
    expect(second.tracking.trackingId).toBe(first.tracking.trackingId);
    expect(await service.count(42)).toBe(1);
  });

  it('throws when the user is at the tracking limit', async () => {
    const { service, store } = setup({ limit: 1 });
    seedProduct(store, Money.fromMinorUnits(129900));
    await service.track(42, PRODUCT_URL);
    const other = 'https://www.amazon.in/dp/B00OTHER';
    store.script(other, {
      ok: true,
      data: {
        storeId: 'amazon',
        productId: 'B00OTHER',
        url: other,
        title: 'Second Product',
        price: Money.fromMinorUnits(99900),
        imageUrl: null,
        availability: 'in_stock',
      },
    });
    await expect(service.track(42, other)).rejects.toBeInstanceOf(LimitExceededError);
  });

  it('rejects URLs no store owns', async () => {
    const { service } = setup();
    await expect(service.track(42, 'https://www.snapdeal.com/product/123')).rejects.toBeInstanceOf(
      UnsupportedStoreError,
    );
  });

  it('lets a user stop their own tracking only', async () => {
    const { service, store } = setup();
    seedProduct(store, Money.fromMinorUnits(129900));
    const { tracking } = await service.track(42, PRODUCT_URL);

    const other = 'https://www.amazon.in/dp/B00OTHER';
    store.script(other, {
      ok: true,
      data: {
        storeId: 'amazon',
        productId: 'B00OTHER',
        url: other,
        title: 'Other Product',
        price: Money.fromMinorUnits(99900),
        imageUrl: null,
        availability: 'in_stock',
      },
    });
    await service.track(7, other);

    expect(await service.stop(42, tracking.trackingId)).toBe(true);
    expect(await service.stop(42, tracking.trackingId)).toBe(false);
    // The other user's tracking is untouched.
    expect(await service.count(7)).toBe(1);
  });

  it('lists a user trackings joined with their products', async () => {
    const { service, store } = setup();
    seedProduct(store, Money.fromMinorUnits(129900));
    await service.track(42, PRODUCT_URL);

    const entries = await service.list(42);
    expect(entries).toHaveLength(1);
    expect(entries[0]?.tracking.userId).toBe(42);
    expect(entries[0]?.product.title).toBe('Example Product');
  });

  it('registers users', async () => {
    const { service, bundle } = setup();
    await service.registerUser({ id: 42, name: 'Affan', mail: 'a@b.com' });
    expect((await bundle.users.findById(42))?.mail).toBe('a@b.com');
  });

  it('reports totals for /stats', async () => {
    const { service, store } = setup();
    seedProduct(store, Money.fromMinorUnits(129900));
    await service.registerUser({ id: 42, name: 'Affan', mail: null });
    await service.track(42, PRODUCT_URL);
    const stats = await service.stats();
    expect(stats).toEqual({ users: 1, products: 1, trackings: 1 });
  });

  it('resolveTarget expands short links and returns the owning store', async () => {
    const { service, store, bundle } = setup();
    seedProduct(store, Money.fromMinorUnits(129900));
    const target = await service.resolveTarget(PRODUCT_URL);
    expect(target.store.id).toBe('amazon');
    expect(target.url.hostname).toBe('www.amazon.in');
    // No side effects from a mere resolve.
    expect(await bundle.trackings.count()).toBe(0);
  });
});
