import { type Money } from '../entities/money.js';
import { productKeyString, type ProductRecord } from '../entities/product.js';
import { type Clock } from '../ports/clock.js';
import { type Fetcher } from '../ports/fetcher.js';
import { type Logger } from '../ports/logger.js';
import { type PriceNotifier } from '../ports/notifier.js';
import {
  type ProductRepository,
  type SnapshotRepository,
  type TrackingRepository,
} from '../ports/repositories.js';
import { type Store } from '../ports/store.js';
import { KeyedMutex } from '../utils/keyed-mutex.js';
import {
  availabilityChanged,
  priceChanged,
  type NotificationStrategy,
  type PriceChange,
} from './notification-strategy.js';
import { type StoreResolver } from './store-resolver.js';

export interface PriceCheckServiceDeps {
  storeResolver: StoreResolver;
  fetcher: Fetcher;
  products: ProductRepository;
  trackings: TrackingRepository;
  snapshots: SnapshotRepository;
  priceNotifier: PriceNotifier;
  strategy: NotificationStrategy;
  clock: Clock;
  logger: Logger;
  mutex?: KeyedMutex;
}

export interface PriceCheckResult {
  storeId: string;
  productId: string;
  changed: boolean;
  notified: number;
  previousPrice: Money | null;
  newPrice: Money | null;
}

export interface CheckAllResult {
  checked: number;
  changed: number;
  notified: number;
  failed: number;
}

/** Re-scrapes products, persists changes and fans out notifications. */
export class PriceCheckService {
  private readonly mutex: KeyedMutex;

  constructor(private readonly deps: PriceCheckServiceDeps) {
    this.mutex = deps.mutex ?? new KeyedMutex();
  }

  async checkProduct(product: ProductRecord): Promise<PriceCheckResult> {
    const key = productKeyString(product);
    return this.mutex.run(key, () => this.check(product));
  }

  private async check(product: ProductRecord): Promise<PriceCheckResult> {
    const {
      storeResolver,
      fetcher,
      products,
      snapshots,
      priceNotifier,
      strategy,
      clock,
      logger,
      trackings,
    } = this.deps;
    const base: PriceCheckResult = {
      storeId: product.storeId,
      productId: product.productId,
      changed: false,
      notified: 0,
      previousPrice: product.currentPrice,
      newPrice: product.currentPrice,
    };

    let store: Store;
    try {
      store = storeResolver.resolve(new URL(product.url));
    } catch (error) {
      logger.warn({ error, url: product.url }, 'no store for product url');
      return base;
    }

    let data;
    try {
      data = await store.fetchProduct(new URL(product.url), {
        fetcher,
        logger: logger.child({ store: store.id, productId: product.productId }),
      });
    } catch (error) {
      logger.warn({ error, productId: product.productId }, 'price check scrape failed');
      return base;
    }

    const change: PriceChange = {
      previousPrice: product.currentPrice,
      newPrice: data.price,
      previousAvailability: product.availability,
      newAvailability: data.availability,
    };

    const changed = priceChanged(change) || availabilityChanged(change);
    if (!changed) {
      return base;
    }

    const now = clock.now();
    await products.updateSnapshot(
      { storeId: product.storeId, productId: product.productId },
      { price: data.price, availability: data.availability, now },
    );
    await snapshots.append({
      storeId: product.storeId,
      productId: product.productId,
      price: data.price,
      availability: data.availability,
      capturedAt: now,
    });

    const result: PriceCheckResult = { ...base, changed: true, newPrice: data.price };

    if (!strategy.shouldNotify(change)) {
      return result;
    }

    const subscribers = await trackings.listByProduct({
      storeId: product.storeId,
      productId: product.productId,
    });

    let notified = 0;
    for (const subscriber of subscribers) {
      try {
        await priceNotifier.notify({
          userId: subscriber.userId,
          trackingId: subscriber.trackingId,
          product: {
            storeId: product.storeId,
            productId: product.productId,
            title: data.title,
            url: data.url,
            imageUrl: data.imageUrl,
            storeName: store.name,
          },
          previousPrice: product.currentPrice,
          newPrice: data.price,
          previousAvailability: product.availability,
          newAvailability: data.availability,
        });
        notified += 1;
      } catch (error) {
        logger.warn({ error, userId: subscriber.userId }, 'failed to notify user');
      }
    }

    result.notified = notified;
    return result;
  }

  async checkAll(): Promise<CheckAllResult> {
    const products = await this.deps.products.listAll();
    const summary: CheckAllResult = { checked: 0, changed: 0, notified: 0, failed: 0 };
    for (const product of products) {
      summary.checked += 1;
      try {
        const result = await this.checkProduct(product);
        if (result.changed) summary.changed += 1;
        summary.notified += result.notified;
      } catch {
        summary.failed += 1;
      }
    }
    return summary;
  }
}
