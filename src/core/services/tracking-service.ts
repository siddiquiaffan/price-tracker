import { productKeyString, type ProductRecord } from '../entities/product.js';
import { type TrackingRecord, type TrackingWithProduct } from '../entities/tracking.js';
import { type UserRecord } from '../entities/user.js';
import { LimitExceededError } from '../errors/app-error.js';
import { type Clock } from '../ports/clock.js';
import { type Fetcher } from '../ports/fetcher.js';
import { type Logger } from '../ports/logger.js';
import { type ProductRepository, type TrackingRepository } from '../ports/repositories.js';
import { type Store } from '../ports/store.js';
import { type UserRepository } from '../ports/user-repository.js';
import { type StoreResolver } from './store-resolver.js';
import { type UrlResolver } from './url-resolver.js';

export interface TrackingServiceDeps {
  storeResolver: StoreResolver;
  urlResolver: UrlResolver;
  fetcher: Fetcher;
  products: ProductRepository;
  trackings: TrackingRepository;
  users: UserRepository;
  clock: Clock;
  logger: Logger;
  limit: number;
  trackingIdFactory: () => string;
}

export interface TrackResult {
  product: ProductRecord;
  tracking: TrackingRecord;
  added: boolean;
}

export interface Stats {
  users: number;
  products: number;
  trackings: number;
}

/** Use cases around subscribing a user to a product's price. */
export class TrackingService {
  private readonly deps: TrackingServiceDeps;

  constructor(deps: TrackingServiceDeps) {
    this.deps = deps;
  }

  /** Expand the short link and resolve the owning store (no scraping). */
  async resolveTarget(rawUrl: string): Promise<{ url: URL; store: Store }> {
    const url = await this.deps.urlResolver.resolve(rawUrl);
    const store = this.deps.storeResolver.resolve(url);
    return { url, store };
  }

  async track(userId: number, rawUrl: string): Promise<TrackResult> {
    const { url, store } = await this.resolveTarget(rawUrl);
    return this.trackTarget(userId, url, store);
  }

  /** Track an already-resolved target (avoids re-expanding the short link). */
  async trackTarget(userId: number, url: URL, store: Store): Promise<TrackResult> {
    const { trackings, products, logger } = this.deps;
    const normalized = store.normalizeUrl(url);
    const productId = store.extractProductId(normalized);
    const key = { storeId: store.id, productId };

    const existing = await trackings.findByUserAndProduct(userId, key);
    if (existing) {
      const product = await products.findByKey(key);
      if (product) {
        return { product, tracking: existing, added: false };
      }
    }

    const count = await trackings.countByUser(userId);
    if (count >= this.deps.limit) {
      throw new LimitExceededError(
        `User ${userId} reached the tracking limit of ${this.deps.limit}`,
        this.deps.limit,
      );
    }

    const data = await store.fetchProduct(normalized, {
      fetcher: this.deps.fetcher,
      logger: logger.child({ store: store.id, productId }),
    });

    return trackings.addTracking({
      data,
      userId,
      trackingId: this.deps.trackingIdFactory(),
      now: this.deps.clock.now(),
    });
  }

  /** Removes only the caller's own tracking. Returns false when nothing matched. */
  async stop(userId: number, trackingId: string): Promise<boolean> {
    return this.deps.trackings.removeTracking(userId, trackingId);
  }

  async list(userId: number): Promise<TrackingWithProduct[]> {
    const trackings = await this.deps.trackings.listByUser(userId);
    const products = await this.deps.products.findManyByKeys(trackings);
    const byKey = new Map(products.map((product) => [productKeyString(product), product]));
    const result: TrackingWithProduct[] = [];
    for (const tracking of trackings) {
      const product = byKey.get(productKeyString(tracking));
      if (product) result.push({ tracking, product });
    }
    return result;
  }

  async count(userId: number): Promise<number> {
    return this.deps.trackings.countByUser(userId);
  }

  /** Total number of trackings across all users (API /stats). */
  async countTrackings(): Promise<number> {
    return this.deps.trackings.count();
  }

  async registerUser(user: UserRecord): Promise<void> {
    await this.deps.users.upsert(user);
  }

  async stats(): Promise<Stats> {
    const [users, products, trackings] = await Promise.all([
      this.deps.users.count(),
      this.deps.products.count(),
      this.deps.trackings.count(),
    ]);
    return { users, products, trackings };
  }
}
