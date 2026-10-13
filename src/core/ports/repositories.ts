import { type Money } from '../entities/money.js';
import { type PriceSnapshot } from '../entities/price-snapshot.js';
import {
  type Availability,
  type ProductData,
  type ProductKey,
  type ProductRecord,
} from '../entities/product.js';
import { type TrackingRecord } from '../entities/tracking.js';

export interface ProductRepository {
  findByKey(key: ProductKey): Promise<ProductRecord | null>;
  findById(id: string): Promise<ProductRecord | null>;
  findManyByKeys(keys: readonly ProductKey[]): Promise<ProductRecord[]>;
  listAll(): Promise<ProductRecord[]>;
  /** Create or refresh product metadata (title/image/url). Does not touch price history. */
  upsert(data: ProductData, now: Date): Promise<ProductRecord>;
  /** Persist a new price/availability observation for a product. */
  updateSnapshot(
    key: ProductKey,
    update: { price: Money | null; availability: Availability; now: Date },
  ): Promise<ProductRecord | null>;
  count(): Promise<number>;
}

export interface AddTrackingInput {
  data: ProductData;
  userId: number;
  trackingId: string;
  now: Date;
}

export interface AddTrackingResult {
  product: ProductRecord;
  tracking: TrackingRecord;
  /** False when the user was already tracking this product (idempotent). */
  added: boolean;
}

export interface TrackingRepository {
  /** Atomic: ensure the product exists and add the user's tracking if absent. */
  addTracking(input: AddTrackingInput): Promise<AddTrackingResult>;
  /** Atomic: remove a user's own tracking. Returns whether anything was removed. */
  removeTracking(userId: number, trackingId: string): Promise<boolean>;
  findByUserAndTracking(userId: number, trackingId: string): Promise<TrackingRecord | null>;
  findByUserAndProduct(userId: number, key: ProductKey): Promise<TrackingRecord | null>;
  listByUser(userId: number): Promise<TrackingRecord[]>;
  /** All subscriptions for a product, used to fan out price-change notifications. */
  listByProduct(key: ProductKey): Promise<TrackingRecord[]>;
  listAll(): Promise<TrackingRecord[]>;
  countByUser(userId: number): Promise<number>;
  count(): Promise<number>;
  deleteByProduct(key: ProductKey): Promise<number>;
}

export interface SnapshotRepository {
  append(snapshot: Omit<PriceSnapshot, 'id'>): Promise<PriceSnapshot>;
  listByProduct(key: ProductKey, limit?: number): Promise<PriceSnapshot[]>;
}
