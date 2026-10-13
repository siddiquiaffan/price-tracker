import { type Collection, type Db } from 'mongodb';
import { type PriceSnapshot } from '../../../core/entities/price-snapshot.js';
import { type ProductKey } from '../../../core/entities/product.js';
import { type SnapshotRepository } from '../../../core/ports/repositories.js';
import { SNAPSHOTS_COLLECTION } from '../collections.js';
import {
  DEFAULT_STORED_CURRENCY,
  moneyToStored,
  normalizeStoredAvailability,
  parseStoredPrice,
  type SnapshotDoc,
} from '../task-mapper.js';

export class MongoSnapshotRepository implements SnapshotRepository {
  private readonly collection: Collection<SnapshotDoc>;

  constructor(db: Db) {
    this.collection = db.collection<SnapshotDoc>(SNAPSHOTS_COLLECTION);
  }

  async append(snapshot: Omit<PriceSnapshot, 'id'>): Promise<PriceSnapshot> {
    const doc: Omit<SnapshotDoc, '_id'> = {
      merchant: snapshot.storeId,
      productId: snapshot.productId,
      price: moneyToStored(snapshot.price),
      currency: snapshot.price?.currency ?? DEFAULT_STORED_CURRENCY,
      availability: snapshot.availability,
      capturedAt: snapshot.capturedAt,
    };
    const result = await this.collection.insertOne(doc);
    return { id: result.insertedId?.toString() ?? '', ...snapshot };
  }

  async listByProduct(key: ProductKey, limit = 100): Promise<PriceSnapshot[]> {
    const docs = await this.collection
      .find({ merchant: key.storeId, productId: key.productId })
      .sort({ capturedAt: -1 })
      .limit(limit)
      .toArray();
    return docs.map((doc) => ({
      id: doc._id?.toString() ?? '',
      storeId: doc.merchant,
      productId: doc.productId,
      price: parseStoredPrice(doc.price, doc.currency ?? DEFAULT_STORED_CURRENCY),
      availability: normalizeStoredAvailability(doc.availability),
      capturedAt: doc.capturedAt,
    }));
  }
}
