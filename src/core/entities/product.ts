import { ValidationError } from '../errors/app-error.js';
import { type Money } from './money.js';

export type Availability = 'in_stock' | 'out_of_stock' | 'unknown';

export interface ProductKey {
  storeId: string;
  productId: string;
}

/** The result of scraping a product page. */
export interface ProductData {
  storeId: string;
  productId: string;
  /** Canonical, tracking-parameter-free URL. */
  url: string;
  title: string;
  /** Null when the product is out of stock or the price is hidden. */
  price: Money | null;
  imageUrl: string | null;
  availability: Availability;
}

/** A product as persisted (shared by all users tracking it). */
export interface ProductRecord extends ProductKey {
  id: string;
  url: string;
  title: string;
  currentPrice: Money | null;
  initialPrice: Money | null;
  imageUrl: string | null;
  availability: Availability;
  lastCheckedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export function productKeyString(key: ProductKey): string {
  return `${key.storeId}:${key.productId}`;
}

function assertNonEmpty(value: string, field: string): void {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new ValidationError(`Product ${field} must be a non-empty string`);
  }
}

export function assertProductData(data: ProductData): void {
  assertNonEmpty(data.storeId, 'storeId');
  assertNonEmpty(data.productId, 'productId');
  assertNonEmpty(data.url, 'url');
  if (data.price?.isNegative()) {
    throw new ValidationError('Product price cannot be negative');
  }
}

export function productDataFrom(input: {
  storeId: string;
  productId: string;
  url: string;
  title: string;
  price: Money | null;
  imageUrl: string | null;
  availability: Availability;
}): ProductData {
  const data: ProductData = {
    storeId: input.storeId,
    productId: input.productId,
    url: input.url,
    title: input.title,
    price: input.price,
    imageUrl: input.imageUrl,
    availability: input.availability,
  };
  assertProductData(data);
  return data;
}
