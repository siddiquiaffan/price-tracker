import { type Collection, type Db, type Filter } from 'mongodb';
import { type ProductKey } from '../../../core/entities/product.js';
import { type TrackingRecord } from '../../../core/entities/tracking.js';
import {
  type AddTrackingInput,
  type AddTrackingResult,
  type TrackingRepository,
} from '../../../core/ports/repositories.js';
import { TASKS_COLLECTION } from '../collections.js';
import {
  DEFAULT_STORED_CURRENCY,
  moneyToStored,
  taskDocToProduct,
  taskDocToTracking,
  type ProductKeyResolver,
  type TaskDoc,
  type TaskUserDoc,
} from '../task-mapper.js';

export class MongoTrackingRepository implements TrackingRepository {
  private readonly collection: Collection<TaskDoc>;

  constructor(
    db: Db,
    private readonly resolveKey: ProductKeyResolver,
  ) {
    this.collection = db.collection<TaskDoc>(TASKS_COLLECTION);
  }

  private keyFilter(key: ProductKey): Filter<TaskDoc> {
    return { merchant: key.storeId, productId: key.productId };
  }

  async addTracking(input: AddTrackingInput): Promise<AddTrackingResult> {
    const { data, userId, trackingId, now } = input;
    const existing = await this.collection.findOne({ link: data.url });
    const wasTracked = existing?.users?.some((user) => user.userId === userId) ?? false;
    const currency = data.price?.currency ?? DEFAULT_STORED_CURRENCY;

    await this.collection.updateOne(
      { link: data.url },
      [
        {
          $set: {
            link: data.url,
            merchant: data.storeId,
            productId: data.productId,
            title: data.title,
            image: data.imageUrl,
            availability: data.availability,
            currency: { $ifNull: ['$currency', currency] },
            initPrice: { $ifNull: ['$initPrice', moneyToStored(data.price)] },
            price: { $ifNull: ['$price', moneyToStored(data.price)] },
            createdAt: { $ifNull: ['$createdAt', now] },
            updatedAt: now,
            users: {
              $concatArrays: [
                { $ifNull: ['$users', []] },
                {
                  $cond: [
                    {
                      $in: [
                        userId,
                        { $map: { input: { $ifNull: ['$users', []] }, as: 'u', in: '$$u.userId' } },
                      ],
                    },
                    [],
                    [{ userId, tracking_id: trackingId, createdAt: now }],
                  ],
                },
              ],
            },
          },
        },
      ],
      { upsert: true },
    );

    const doc = await this.collection.findOne({ link: data.url });
    if (!doc) throw new Error(`addTracking did not return a document for ${data.url}`);
    const userDoc: TaskUserDoc = doc.users?.find((user) => user.userId === userId) ?? {
      userId,
      tracking_id: trackingId,
      createdAt: now,
    };

    return {
      product: taskDocToProduct(doc, this.resolveKey),
      tracking: taskDocToTracking(doc, userDoc, this.resolveKey),
      added: !wasTracked,
    };
  }

  async removeTracking(userId: number, trackingId: string): Promise<boolean> {
    const result = await this.collection.updateOne(
      { users: { $elemMatch: { userId, tracking_id: trackingId } } },
      { $pull: { users: { userId, tracking_id: trackingId } } },
    );
    if (result.modifiedCount === 0) return false;
    await this.collection.deleteMany({ users: { $size: 0 } });
    return true;
  }

  async findByUserAndTracking(userId: number, trackingId: string): Promise<TrackingRecord | null> {
    const doc = await this.collection.findOne({
      users: { $elemMatch: { userId, tracking_id: trackingId } },
    });
    const userDoc = doc?.users?.find(
      (user) => user.userId === userId && user.tracking_id === trackingId,
    );
    return doc && userDoc ? taskDocToTracking(doc, userDoc, this.resolveKey) : null;
  }

  async findByUserAndProduct(userId: number, key: ProductKey): Promise<TrackingRecord | null> {
    const doc = await this.collection.findOne(this.keyFilter(key));
    const userDoc = doc?.users?.find((user) => user.userId === userId);
    return doc && userDoc ? taskDocToTracking(doc, userDoc, this.resolveKey) : null;
  }

  async listByUser(userId: number): Promise<TrackingRecord[]> {
    const docs = await this.collection.find({ 'users.userId': userId }).toArray();
    const result: TrackingRecord[] = [];
    for (const doc of docs) {
      for (const user of doc.users ?? []) {
        if (user.userId === userId) result.push(taskDocToTracking(doc, user, this.resolveKey));
      }
    }
    return result;
  }

  async listByProduct(key: ProductKey): Promise<TrackingRecord[]> {
    const docs = await this.collection.find(this.keyFilter(key)).toArray();
    const result: TrackingRecord[] = [];
    for (const doc of docs) {
      for (const user of doc.users ?? [])
        result.push(taskDocToTracking(doc, user, this.resolveKey));
    }
    return result;
  }

  async listAll(): Promise<TrackingRecord[]> {
    const docs = await this.collection.find({}).toArray();
    const result: TrackingRecord[] = [];
    for (const doc of docs) {
      for (const user of doc.users ?? [])
        result.push(taskDocToTracking(doc, user, this.resolveKey));
    }
    return result;
  }

  async countByUser(userId: number): Promise<number> {
    return this.collection.countDocuments({ 'users.userId': userId });
  }

  async count(): Promise<number> {
    const result = await this.collection
      .aggregate<{ total: number }>([
        { $group: { _id: null, total: { $sum: { $size: { $ifNull: ['$users', []] } } } } },
      ])
      .toArray();
    return result[0]?.total ?? 0;
  }

  async deleteByProduct(key: ProductKey): Promise<number> {
    const result = await this.collection.deleteOne(this.keyFilter(key));
    return result.deletedCount;
  }
}
