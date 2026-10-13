import { MongoClient, type Db } from 'mongodb';
import { type Logger } from '../../core/ports/logger.js';
import { DB_NAME } from './collections.js';

export interface MongoConnectionOptions {
  url: string;
  dbName?: string;
  logger: Logger;
}

/** Lazily connects and reuses a single MongoDB client. */
export class MongoConnection {
  private client: MongoClient | null = null;
  private readonly url: string;
  private readonly dbName: string;
  private readonly logger: Logger;

  constructor(options: MongoConnectionOptions) {
    this.url = options.url;
    this.dbName = options.dbName ?? DB_NAME;
    this.logger = options.logger;
  }

  async connect(): Promise<Db> {
    if (!this.client) {
      this.client = new MongoClient(this.url);
      await this.client.connect();
      this.logger.info({ dbName: this.dbName }, 'connected to MongoDB');
    }
    return this.client.db(this.dbName);
  }

  async db(): Promise<Db> {
    return this.connect();
  }

  async close(): Promise<void> {
    if (this.client) {
      await this.client.close();
      this.client = null;
    }
  }
}
