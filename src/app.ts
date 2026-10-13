import { Bot } from 'grammy';
import { type Hono } from 'hono';
import { type Db } from 'mongodb';
import { type AppConfig } from './config/env.js';
import { type Fetcher } from './core/ports/fetcher.js';
import { type JobQueue } from './core/ports/job-queue.js';
import { type Logger } from './core/ports/logger.js';
import { type Notifier, type PriceNotifier } from './core/ports/notifier.js';
import {
  type ProductRepository,
  type SnapshotRepository,
  type TrackingRepository,
} from './core/ports/repositories.js';
import { type UserRepository } from './core/ports/user-repository.js';
import { SystemClock, type Clock } from './core/ports/clock.js';
import { PriceCheckService } from './core/services/price-check-service.js';
import { StoreResolver } from './core/services/store-resolver.js';
import { TrackingService } from './core/services/tracking-service.js';
import { UrlResolver } from './core/services/url-resolver.js';
import { createNotificationStrategy } from './core/services/notification-strategy.js';
import { createStoreRegistry, type InMemoryStoreRegistry } from './stores/index.js';
import { createPoolRegistry, type EgressPoolRegistry } from './infra/egress/index.js';
import { CompositeBlockDetector } from './infra/egress/block-detector.js';
import { DnsHostResolver } from './infra/network/index.js';
import { PinoLogger } from './infra/logger/index.js';
import {
  backfillTaskDocuments,
  ensureIndexes,
  MongoConnection,
  MongoProductRepository,
  MongoSnapshotRepository,
  MongoTrackingRepository,
  MongoUserRepository,
  type ProductKeyResolver,
} from './infra/db/index.js';
import { InMemoryJobQueue } from './infra/queue/index.js';
import { BullMqJobQueue } from './infra/queue/bullmq-queue.js';
import { EgressFetcher } from './infra/http/fetcher.js';
import { createTrackingIdFactory } from './infra/id/index.js';
import { createApiServer } from './interfaces/api/index.js';
import {
  createTelegramBot,
  TelegramNotifier,
  TelegramPriceNotifier,
} from './interfaces/telegram/index.js';
import { Scheduler } from './scheduler/scheduler.js';
import { startCheckWorker } from './compose/check-worker.js';

export interface AppContainer {
  config: AppConfig;
  logger: Logger;
  clock: Clock;
  db: Db;
  queue: JobQueue;
  bot: Bot;
  api: Hono;
  scheduler: Scheduler;
  trackingService: TrackingService;
  priceCheckService: PriceCheckService;
  products: ProductRepository;
  trackings: TrackingRepository;
  snapshots: SnapshotRepository;
  users: UserRepository;
  pools: EgressPoolRegistry;
  storeRegistry: InMemoryStoreRegistry;
  startWorker(): Promise<void>;
  close(): Promise<void>;
}

export interface CreateAppOptions {
  queue?: JobQueue;
  fetcher?: Fetcher;
  notifier?: Notifier;
  priceNotifier?: PriceNotifier;
}

/** Wire the whole application together (composition root). */
export async function createApp(
  config: AppConfig,
  options: CreateAppOptions = {},
): Promise<AppContainer> {
  const logger = PinoLogger.create({ level: config.logLevel, name: 'price-tracker' });
  const clock = new SystemClock();

  // --- stores + block detection ---
  const blockDetector = new CompositeBlockDetector();
  const storeRegistry = createStoreRegistry({ blockDetector });

  // --- database ---
  const mongo = new MongoConnection({ url: config.db.url, dbName: config.db.name, logger });
  const db = await mongo.connect();
  await ensureIndexes(db, logger);

  const resolveKey: ProductKeyResolver = (merchant, link) => {
    try {
      const url = new URL(link);
      const store = storeRegistry.find(url);
      if (store)
        return { storeId: store.id, productId: store.extractProductId(store.normalizeUrl(url)) };
    } catch {
      // fall through to the raw document values
    }
    return { storeId: merchant, productId: link };
  };
  await backfillTaskDocuments(db, resolveKey, logger);

  const products = new MongoProductRepository(db, resolveKey);
  const trackings = new MongoTrackingRepository(db, resolveKey);
  const snapshots = new MongoSnapshotRepository(db);
  const users = new MongoUserRepository(db);

  // --- egress ---
  const pools = createPoolRegistry({
    config: config.egress,
    clock,
    logger,
    blockDetector,
    requestTimeoutMs: config.requestTimeoutMs,
    failureThreshold: 2,
  });
  const fetcher =
    options.fetcher ?? new EgressFetcher({ pools, logger, timeoutMs: config.requestTimeoutMs });

  // --- core services ---
  const urlResolver = new UrlResolver({
    fetcher,
    hostResolver: new DnsHostResolver(),
    logger,
    isProductUrl: (url) => storeRegistry.find(url) !== null,
  });
  const storeResolver = new StoreResolver(storeRegistry);

  const trackingService = new TrackingService({
    storeResolver,
    urlResolver,
    fetcher,
    products,
    trackings,
    users,
    clock,
    logger,
    limit: config.limit,
    trackingIdFactory: createTrackingIdFactory(),
  });

  // --- notifications ---
  const baseBot = new Bot(config.bot.token);
  const notifier = options.notifier ?? new TelegramNotifier(baseBot.api, logger);
  const priceNotifier =
    options.priceNotifier ??
    new TelegramPriceNotifier(notifier, { affiliateTag: config.stores.amazonAffiliateTag });

  const priceCheckService = new PriceCheckService({
    storeResolver,
    fetcher,
    products,
    trackings,
    snapshots,
    priceNotifier,
    strategy: createNotificationStrategy(
      config.notifications.strategy,
      config.notifications.thresholdPercent,
    ),
    clock,
    logger,
  });

  // --- queue ---
  const queue =
    options.queue ??
    (config.isProduction && config.redisUrl
      ? new BullMqJobQueue({ redisUrl: config.redisUrl, logger })
      : new InMemoryJobQueue(logger));

  const scheduler = new Scheduler({
    queue,
    products,
    intervalMs: config.schedule.intervalMs,
    jitterRatio: config.schedule.jitterRatio,
    logger,
    clock,
  });

  // --- bot + api ---
  const bot = createTelegramBot({
    token: config.bot.token,
    admins: config.bot.admins,
    limit: config.limit,
    logger,
    trackingService,
    priceCheckService,
    users,
    notifier,
    bot: baseBot,
  });
  const api = createApiServer({ apiKey: config.api.key, logger, trackingService, users, bot });

  const container: AppContainer = {
    config,
    logger,
    clock,
    db,
    queue,
    bot,
    api,
    scheduler,
    trackingService,
    priceCheckService,
    products,
    trackings,
    snapshots,
    users,
    pools,
    storeRegistry,
    async startWorker() {
      await startCheckWorker({
        queue,
        products,
        priceCheck: priceCheckService,
        concurrency: 5,
        logger,
      });
    },
    async close() {
      scheduler.stop();
      await queue.close();
      await pools.close();
      await mongo.close();
    },
  };

  return container;
}

export type { AppConfig };
export { ConfigError, loadConfig, parseAdmins } from './config/env.js';
