import { type UserRecord } from '../entities/user.js';

export interface UserRepository {
  upsert(user: UserRecord): Promise<void>;
  findById(id: number): Promise<UserRecord | null>;
  listAll(): Promise<UserRecord[]>;
  count(): Promise<number>;
}
