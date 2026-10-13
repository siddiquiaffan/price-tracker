import { type ProductRecord } from './product.js';

/** One user's subscription to a product. */
export interface TrackingRecord {
  id: string;
  trackingId: string;
  userId: number;
  storeId: string;
  productId: string;
  createdAt: Date;
}

export interface TrackingWithProduct {
  tracking: TrackingRecord;
  product: ProductRecord;
}
