import { type Money } from './money.js';
import { type Availability } from './product.js';

/** A price observation recorded only when the price/availability changes. */
export interface PriceSnapshot {
  id: string;
  storeId: string;
  productId: string;
  price: Money | null;
  availability: Availability;
  capturedAt: Date;
}
