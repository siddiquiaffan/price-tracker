import { type ObjectId } from 'mongodb';
import { Money } from '../../core/entities/money.js';
import {
  type Availability,
  type ProductKey,
  type ProductRecord,
} from '../../core/entities/product.js';
import { type TrackingRecord } from '../../core/entities/tracking.js';

/** One subscriber inside a `tasks` document. */
export interface TaskUserDoc {
  userId: number;
  tracking_id: string;
  createdAt?: Date;
}

/**
 * A document in the shared `tasks` collection. New fields (`productId`,
 * `currency`, `image`, `availability`, `lastCheckedAt`) are additive so legacy
 * deployments keep their data (A6).
 */
export interface TaskDoc {
  _id: ObjectId;
  link: string;
  merchant: string;
  productId?: string;
  initPrice?: string | number | null;
  price?: string | number | null;
  currency?: string;
  title?: string;
  image?: string | null;
  availability?: string;
  lastCheckedAt?: Date;
  createdAt?: Date;
  updatedAt?: Date;
  users?: TaskUserDoc[];
}

export interface UserDoc {
  _id?: ObjectId;
  id: number;
  name: string;
  mail?: string | null;
}

export interface SnapshotDoc {
  _id?: ObjectId;
  merchant: string;
  productId: string;
  price?: string | number | null;
  currency?: string;
  availability?: string;
  capturedAt: Date;
}

/** Derives a product key for legacy documents that predate the `productId` field. */
export type ProductKeyResolver = (merchant: string, link: string) => ProductKey;

export const DEFAULT_STORED_CURRENCY = 'INR';

export function parseStoredPrice(value: unknown, currency: string): Money | null {
  if (value === null || value === undefined) return null;
  const text =
    typeof value === 'number' ? String(value) : typeof value === 'string' ? value.trim() : '';
  if (text.length === 0) return null;
  try {
    return Money.parse(text, currency);
  } catch {
    return null;
  }
}

export function moneyToStored(money: Money | null): string | null {
  return money ? money.toMajorString() : null;
}

export function normalizeStoredAvailability(value: unknown): Availability {
  if (typeof value !== 'string') return 'unknown';
  const normalized = value.toLowerCase().replace(/[-\s]/g, '_');
  if (normalized === 'in_stock' || normalized === 'instock') return 'in_stock';
  if (normalized === 'out_of_stock' || normalized === 'outofstock') return 'out_of_stock';
  return 'unknown';
}

export function taskDocToProduct(doc: TaskDoc, resolveKey: ProductKeyResolver): ProductRecord {
  const key: ProductKey = doc.productId
    ? { storeId: doc.merchant, productId: doc.productId }
    : resolveKey(doc.merchant, doc.link);
  const currency = doc.currency ?? DEFAULT_STORED_CURRENCY;
  const currentPrice = parseStoredPrice(doc.price, currency);
  const initialPrice = parseStoredPrice(doc.initPrice, currency) ?? currentPrice;
  const createdAt = doc.createdAt ?? doc._id.getTimestamp();

  return {
    id: doc._id.toString(),
    storeId: key.storeId,
    productId: key.productId,
    url: doc.link,
    title: doc.title ?? '',
    currentPrice,
    initialPrice,
    imageUrl: doc.image ?? null,
    availability: normalizeStoredAvailability(doc.availability),
    lastCheckedAt: doc.lastCheckedAt ?? null,
    createdAt,
    updatedAt: doc.updatedAt ?? createdAt,
  };
}

export function taskDocToTracking(
  doc: TaskDoc,
  user: TaskUserDoc,
  resolveKey: ProductKeyResolver,
): TrackingRecord {
  const key: ProductKey = doc.productId
    ? { storeId: doc.merchant, productId: doc.productId }
    : resolveKey(doc.merchant, doc.link);
  return {
    id: doc._id.toString(),
    trackingId: user.tracking_id,
    userId: user.userId,
    storeId: key.storeId,
    productId: key.productId,
    createdAt: user.createdAt ?? doc.createdAt ?? doc._id.getTimestamp(),
  };
}
