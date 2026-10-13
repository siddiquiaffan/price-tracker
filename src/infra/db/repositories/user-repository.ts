import { type Collection, type Db } from 'mongodb';
import { type UserRecord } from '../../../core/entities/user.js';
import { type UserRepository } from '../../../core/ports/user-repository.js';
import { USERS_COLLECTION } from '../collections.js';
import { type UserDoc } from '../task-mapper.js';

function toUserRecord(doc: UserDoc): UserRecord {
  return { id: doc.id, name: doc.name, mail: doc.mail ?? null };
}

export class MongoUserRepository implements UserRepository {
  private readonly collection: Collection<UserDoc>;

  constructor(db: Db) {
    this.collection = db.collection<UserDoc>(USERS_COLLECTION);
  }

  async upsert(user: UserRecord): Promise<void> {
    const fields: Record<string, unknown> = { id: user.id, name: user.name };
    if (user.mail !== null) fields.mail = user.mail;
    await this.collection.updateOne({ id: user.id }, { $set: fields }, { upsert: true });
  }

  async findById(id: number): Promise<UserRecord | null> {
    const doc = await this.collection.findOne({ id });
    return doc ? toUserRecord(doc) : null;
  }

  async listAll(): Promise<UserRecord[]> {
    const docs = await this.collection.find({}).toArray();
    return docs.map(toUserRecord);
  }

  async count(): Promise<number> {
    return this.collection.countDocuments({});
  }
}
