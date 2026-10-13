import { ObjectId, type Collection, type Db, type Filter } from 'mongodb';
import {
  type ProductData,
  type ProductKey,
  type ProductRecord,
} from '../../../core/entities/product.js';
import { type Money } from '../../../core/entities/money.js';
import { type Availability } from '../../../core/entities/product.js';
import { type ProductRepository } from '../../../core/ports/repositories.js';
import { TASKS_COLLECTION } from '../collections.js';
import {
  DEFAULT_STORED_CURRENCY,
  moneyToStored,
  taskDocToProduct,
  type ProductKeyResolver,
  type TaskDoc,
} from '../task-mapper.js';

export class MongoProductRepository implements ProductRepository {
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

  async findByKey(key: ProductKey): Promise<ProductRecord | null> {
    const doc = await this.collection.findOne(this.keyFilter(key));
    return doc ? taskDocToProduct(doc, this.resolveKey) : null;
  }

  async findById(id: string): Promise<ProductRecord | null> {
    if (!ObjectId.isValid(id)) return null;
    const doc = await this.collection.findOne({ _id: new ObjectId(id) });
    return doc ? taskDocToProduct(doc, this.resolveKey) : null;
  }

  async findManyByKeys(keys: readonly ProductKey[]): Promise<ProductRecord[]> {
    if (keys.length === 0) return [];
    const docs = await this.collection
      .find({ $or: keys.map((key) => this.keyFilter(key)) })
      .toArray();
    return docs.map((doc) => taskDocToProduct(doc, this.resolveKey));
  }

  async listAll(): Promise<ProductRecord[]> {
    const docs = await this.collection.find({}).toArray();
    return docs.map((doc) => taskDocToProduct(doc, this.resolveKey));
  }

  async upsert(data: ProductData, now: Date): Promise<ProductRecord> {
    await this.collection.updateOne(
      { link: data.url },
      {
        $set: {
          link: data.url,
          merchant: data.storeId,
          productId: data.productId,
          title: data.title,
          image: data.imageUrl,
          availability: data.availability,
          updatedAt: now,
        },
        $setOnInsert: {
          currency: data.price?.currency ?? DEFAULT_STORED_CURRENCY,
          initPrice: moneyToStored(data.price),
          price: moneyToStored(data.price),
          createdAt: now,
        },
      },
      { upsert: true },
    );

    const doc = await this.collection.findOne({ link: data.url });
    if (!doc) throw new Error(`Product upsert did not return a document for ${data.url}`);
    return taskDocToProduct(doc, this.resolveKey);
  }

  async updateSnapshot(
    key: ProductKey,
    update: { price: Money | null; availability: Availability; now: Date },
  ): Promise<ProductRecord | null> {
    const fields: Record<string, unknown> = {
      price: moneyToStored(update.price),
      availability: update.availability,
      lastCheckedAt: update.now,
      updatedAt: update.now,
    };
    if (update.price) fields.currency = update.price.currency;

    const doc = await this.collection.findOneAndUpdate(
      this.keyFilter(key),
      { $set: fields },
      { returnDocument: 'after' },
    );
    return doc ? taskDocToProduct(doc, this.resolveKey) : null;
  }

  async count(): Promise<number> {
    return this.collection.countDocuments({});
  }
}
