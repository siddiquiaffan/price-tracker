import { type Money } from '../../src/core/entities/money.js';
import {
  productKeyString,
  type Availability,
  type ProductData,
  type ProductKey,
  type ProductRecord,
} from '../../src/core/entities/product.js';
import { type PriceSnapshot } from '../../src/core/entities/price-snapshot.js';
import { type TrackingRecord } from '../../src/core/entities/tracking.js';
import { type UserRecord } from '../../src/core/entities/user.js';
import {
  type AddTrackingResult,
  type ProductRepository,
  type SnapshotRepository,
  type TrackingRepository,
} from '../../src/core/ports/repositories.js';
import { type UserRepository } from '../../src/core/ports/user-repository.js';

let serial = 0;
function nextId(): string {
  serial += 1;
  return `id-${serial}`;
}

/** In-memory product repository sharing the same backing store as the bundle. */
export class InMemoryProductRepository implements ProductRepository {
  protected readonly byKey = new Map<string, ProductRecord>();

  findByKey(key: ProductKey): Promise<ProductRecord | null> {
    return Promise.resolve(this.byKey.get(productKeyString(key)) ?? null);
  }

  findById(id: string): Promise<ProductRecord | null> {
    for (const product of this.byKey.values()) {
      if (product.id === id) return Promise.resolve(product);
    }
    return Promise.resolve(null);
  }

  findManyByKeys(keys: readonly ProductKey[]): Promise<ProductRecord[]> {
    const result: ProductRecord[] = [];
    for (const key of keys) {
      const found = this.byKey.get(productKeyString(key));
      if (found) result.push(found);
    }
    return Promise.resolve(result);
  }

  listAll(): Promise<ProductRecord[]> {
    return Promise.resolve([...this.byKey.values()]);
  }

  upsert(data: ProductData, now: Date): Promise<ProductRecord> {
    const key = productKeyString(data);
    const existing = this.byKey.get(key);
    if (existing) {
      const updated: ProductRecord = {
        ...existing,
        url: data.url,
        title: data.title,
        imageUrl: data.imageUrl,
        availability: data.availability,
        updatedAt: now,
      };
      this.byKey.set(key, updated);
      return Promise.resolve(updated);
    }
    const created: ProductRecord = {
      storeId: data.storeId,
      productId: data.productId,
      id: nextId(),
      url: data.url,
      title: data.title,
      currentPrice: data.price,
      initialPrice: data.price,
      imageUrl: data.imageUrl,
      availability: data.availability,
      lastCheckedAt: null,
      createdAt: now,
      updatedAt: now,
    };
    this.byKey.set(key, created);
    return Promise.resolve(created);
  }

  updateSnapshot(
    key: ProductKey,
    update: { price: Money | null; availability: Availability; now: Date },
  ): Promise<ProductRecord | null> {
    const existing = this.byKey.get(productKeyString(key));
    if (!existing) return Promise.resolve(null);
    const updated: ProductRecord = {
      ...existing,
      currentPrice: update.price,
      availability: update.availability,
      lastCheckedAt: update.now,
      updatedAt: update.now,
    };
    this.byKey.set(productKeyString(key), updated);
    return Promise.resolve(updated);
  }

  count(): Promise<number> {
    return Promise.resolve(this.byKey.size);
  }
}

/** In-memory tracking repository; addTracking upserts products atomically. */
export class InMemoryTrackingRepository implements TrackingRepository {
  private readonly trackings: TrackingRecord[] = [];
  private readonly products = new InMemoryProductRepository();

  constructor(products?: InMemoryProductRepository) {
    if (products) this.products = products;
  }

  get productRepository(): InMemoryProductRepository {
    return this.products;
  }

  private find(userId: number, key: ProductKey): TrackingRecord | null {
    return (
      this.trackings.find(
        (tracking) =>
          tracking.userId === userId &&
          tracking.storeId === key.storeId &&
          tracking.productId === key.productId,
      ) ?? null
    );
  }

  async addTracking(input: {
    data: ProductData;
    userId: number;
    trackingId: string;
    now: Date;
  }): Promise<AddTrackingResult> {
    const key = { storeId: input.data.storeId, productId: input.data.productId };
    const existing = this.find(input.userId, key);
    if (existing) {
      const product = await this.products.findByKey(key);
      return {
        product: product!,
        tracking: existing,
        added: false,
      };
    }
    const product = await this.products.upsert(input.data, input.now);
    const tracking: TrackingRecord = {
      id: nextId(),
      trackingId: input.trackingId,
      userId: input.userId,
      storeId: input.data.storeId,
      productId: input.data.productId,
      createdAt: input.now,
    };
    this.trackings.push(tracking);
    return { product, tracking, added: true };
  }

  removeTracking(userId: number, trackingId: string): Promise<boolean> {
    const index = this.trackings.findIndex(
      (tracking) => tracking.userId === userId && tracking.trackingId === trackingId,
    );
    if (index === -1) return Promise.resolve(false);
    this.trackings.splice(index, 1);
    return Promise.resolve(true);
  }

  findByUserAndTracking(userId: number, trackingId: string): Promise<TrackingRecord | null> {
    const found =
      this.trackings.find(
        (tracking) => tracking.userId === userId && tracking.trackingId === trackingId,
      ) ?? null;
    return Promise.resolve(found);
  }

  findByUserAndProduct(userId: number, key: ProductKey): Promise<TrackingRecord | null> {
    return Promise.resolve(this.find(userId, key));
  }

  listByUser(userId: number): Promise<TrackingRecord[]> {
    return Promise.resolve(this.trackings.filter((tracking) => tracking.userId === userId));
  }

  listByProduct(key: ProductKey): Promise<TrackingRecord[]> {
    return Promise.resolve(
      this.trackings.filter(
        (tracking) => tracking.storeId === key.storeId && tracking.productId === key.productId,
      ),
    );
  }

  listAll(): Promise<TrackingRecord[]> {
    return Promise.resolve([...this.trackings]);
  }

  countByUser(userId: number): Promise<number> {
    return Promise.resolve(this.trackings.filter((tracking) => tracking.userId === userId).length);
  }

  count(): Promise<number> {
    return Promise.resolve(this.trackings.length);
  }

  deleteByProduct(key: ProductKey): Promise<number> {
    const before = this.trackings.length;
    const remaining = this.trackings.filter(
      (tracking) => tracking.storeId !== key.storeId || tracking.productId !== key.productId,
    );
    this.trackings.length = 0;
    this.trackings.push(...remaining);
    return Promise.resolve(before - remaining.length);
  }
}

/** In-memory price snapshot repository. */
export class InMemorySnapshotRepository implements SnapshotRepository {
  private readonly snapshots: PriceSnapshot[] = [];

  append(snapshot: Omit<PriceSnapshot, 'id'>): Promise<PriceSnapshot> {
    const stored: PriceSnapshot = { ...snapshot, id: nextId() };
    this.snapshots.push(stored);
    return Promise.resolve(stored);
  }

  listByProduct(key: ProductKey, limit?: number): Promise<PriceSnapshot[]> {
    const matching = this.snapshots
      .filter(
        (snapshot) => snapshot.storeId === key.storeId && snapshot.productId === key.productId,
      )
      .sort((a, b) => b.capturedAt.getTime() - a.capturedAt.getTime());
    return Promise.resolve(limit === undefined ? matching : matching.slice(0, limit));
  }
}

/** In-memory user repository. */
export class InMemoryUserRepository implements UserRepository {
  private readonly users = new Map<number, UserRecord>();

  upsert(user: UserRecord): Promise<void> {
    const existing = this.users.get(user.id);
    this.users.set(user.id, { ...(existing ?? {}), id: user.id, name: user.name, mail: user.mail });
    return Promise.resolve();
  }

  findById(id: number): Promise<UserRecord | null> {
    return Promise.resolve(this.users.get(id) ?? null);
  }

  listAll(): Promise<UserRecord[]> {
    return Promise.resolve([...this.users.values()]);
  }

  count(): Promise<number> {
    return Promise.resolve(this.users.size);
  }
}

/** A fully wired in-memory data layer for service tests. */
export function createMemoryBundle(): {
  products: InMemoryProductRepository;
  trackings: InMemoryTrackingRepository;
  snapshots: InMemorySnapshotRepository;
  users: InMemoryUserRepository;
} {
  const products = new InMemoryProductRepository();
  const trackings = new InMemoryTrackingRepository(products);
  return {
    products,
    trackings,
    snapshots: new InMemorySnapshotRepository(),
    users: new InMemoryUserRepository(),
  };
}
