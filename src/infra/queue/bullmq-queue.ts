import { Queue, Worker, type ConnectionOptions, type JobsOptions } from 'bullmq';
import { Redis } from 'ioredis';
import { type Logger } from '../../core/ports/logger.js';
import {
  type EnqueueOptions,
  type Job,
  type JobHandler,
  type JobQueue,
  type ProcessOptions,
} from '../../core/ports/job-queue.js';

export interface BullMqJobQueueOptions {
  redisUrl: string;
  queueName?: string;
  logger: Logger;
}

/**
 * Production {@link JobQueue}: a BullMQ queue backed by Redis with one Worker per
 * registered job name. Locking is provided by BullMQ, so the scheduler is safe to
 * run on multiple instances (fixes B10).
 */
/* eslint-disable @typescript-eslint/no-unnecessary-type-parameters */
export class BullMqJobQueue implements JobQueue {
  private readonly logger: Logger;
  private readonly connection: Redis;
  private readonly queue: Queue;
  private readonly workers: Worker[] = [];

  constructor(options: BullMqJobQueueOptions) {
    this.logger = options.logger;
    this.connection = new Redis(options.redisUrl, { maxRetriesPerRequest: null });
    this.queue = new Queue(options.queueName ?? 'price-tracker', {
      connection: this.connection as unknown as ConnectionOptions,
    });
  }

  async enqueue<T>(name: string, data: T, options: EnqueueOptions = {}): Promise<string> {
    const jobOptions: JobsOptions = {
      removeOnComplete: true,
      removeOnFail: 100,
    };
    if (options.jobId !== undefined) jobOptions.jobId = options.jobId;
    if (options.delayMs !== undefined) jobOptions.delay = options.delayMs;
    if (options.attempts !== undefined) jobOptions.attempts = options.attempts;
    if (options.backoffMs !== undefined)
      jobOptions.backoff = { type: 'exponential', delay: options.backoffMs };

    const job = await this.queue.add(name, data, jobOptions);
    return job.id ?? '';
  }

  async process<T>(
    name: string,
    handler: JobHandler<T>,
    options: ProcessOptions = {},
  ): Promise<void> {
    const worker = new Worker(
      this.queue.name,
      async (job) => {
        const typed: Job<T> = { id: job.id ?? '', name: job.name, data: job.data as T };
        await handler(typed);
      },
      {
        connection: this.connection.duplicate() as unknown as ConnectionOptions,
        concurrency: options.concurrency ?? 1,
      },
    );
    worker.on('failed', (job, error) => {
      this.logger.error({ error, jobId: job?.id, jobName: name }, 'bullmq job failed');
    });
    await worker.waitUntilReady();
    this.workers.push(worker);
  }

  async close(): Promise<void> {
    await Promise.all(this.workers.map(async (worker) => worker.close()));
    await this.queue.close();
    await this.connection.quit();
  }
}
