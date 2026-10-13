import { type Db } from 'mongodb';
import { type Logger } from '../../core/ports/logger.js';
import { SNAPSHOTS_COLLECTION, TASKS_COLLECTION, USERS_COLLECTION } from './collections.js';
import { DEFAULT_STORED_CURRENCY, type ProductKeyResolver, type TaskDoc } from './task-mapper.js';

/**
 * Create indexes the legacy app never had (fixes B9): a unique key per product
 * link, plus lookup indexes for the API and scheduler.
 */
export async function ensureIndexes(db: Db, logger: Logger): Promise<void> {
  const tasks = db.collection(TASKS_COLLECTION);
  try {
    await tasks.createIndex({ link: 1 }, { unique: true, name: 'uniq_link' });
  } catch (error) {
    logger.warn(
      { error },
      'could not create unique index on tasks.link; falling back to non-unique',
    );
    await tasks.createIndex({ link: 1 }, { name: 'link' });
  }
  await tasks.createIndex({ merchant: 1, productId: 1 }, { name: 'merchant_product' });
  await tasks.createIndex({ 'users.userId': 1 }, { name: 'users_userId' });
  await db
    .collection(USERS_COLLECTION)
    .createIndex({ id: 1 }, { unique: true, name: 'uniq_user_id' });
  await db
    .collection(SNAPSHOTS_COLLECTION)
    .createIndex({ merchant: 1, productId: 1, capturedAt: -1 }, { name: 'product_capturedAt' });
}

/**
 * Backfill `productId`/`currency` on documents written by the legacy app so the
 * new repositories can address them by product key (zero-downtime migration).
 */
export async function backfillTaskDocuments(
  db: Db,
  resolveKey: ProductKeyResolver,
  logger: Logger,
): Promise<number> {
  const collection = db.collection<TaskDoc>(TASKS_COLLECTION);
  const cursor = collection.find({
    $or: [{ productId: { $exists: false } }, { productId: { $type: 'null' } }, { productId: '' }],
  });

  let updated = 0;
  for await (const doc of cursor) {
    const key = resolveKey(doc.merchant, doc.link);
    await collection.updateOne(
      { _id: doc._id },
      {
        $set: {
          merchant: key.storeId,
          productId: key.productId,
          currency: doc.currency ?? DEFAULT_STORED_CURRENCY,
        },
      },
    );
    updated += 1;
  }

  if (updated > 0) logger.info({ updated }, 'backfilled legacy task documents');
  return updated;
}
