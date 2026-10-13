import { type Clock } from '../core/ports/clock.js';
import { type JobQueue } from '../core/ports/job-queue.js';
import { type Logger } from '../core/ports/logger.js';
import { type ProductRepository } from '../core/ports/repositories.js';

export interface SchedulerDeps {
  queue: JobQueue;
  products: ProductRepository;
  intervalMs: number;
  /** Random ±jitter applied to the interval so parallel instances spread out. */
  jitterRatio: number;
  /** Stable job id per product so duplicate checks are de-duplicated (fixes B10). */
  attempts?: number;
  backoffMs?: number;
  logger: Logger;
  clock: Clock;
}

/**
 * Hourly re-check loop. It does not scrape anything itself: it enqueues one
 * `check-product` job per product (with a stable job id), and a queue worker
 * runs the actual check. With BullMQ this is safe across many instances.
 */
export class Scheduler {
  private readonly queue: JobQueue;
  private readonly products: ProductRepository;
  private readonly intervalMs: number;
  private readonly jitterRatio: number;
  private readonly attempts: number;
  private readonly backoffMs: number;
  private readonly logger: Logger;
  private readonly clock: Clock;
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(deps: SchedulerDeps) {
    this.queue = deps.queue;
    this.products = deps.products;
    this.intervalMs = deps.intervalMs;
    this.jitterRatio = deps.jitterRatio;
    this.attempts = deps.attempts ?? 2;
    this.backoffMs = deps.backoffMs ?? 5_000;
    this.logger = deps.logger;
    this.clock = deps.clock;
  }

  start(): void {
    if (this.timer) return;
    this.scheduleNext();
  }

  stop(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  private scheduleNext(): void {
    const jitter = 1 + (Math.random() * 2 - 1) * this.jitterRatio;
    const delay = Math.max(Math.round(this.intervalMs * jitter), 1_000);
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.run().finally(() => {
        this.scheduleNext();
      });
    }, delay);
    this.timer.unref?.();
  }

  /** Enqueue a check per product. Overlapping runs are skipped. */
  async run(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const products = await this.products.listAll();
      let enqueued = 0;
      for (const product of products) {
        const jobId = `check:${product.storeId}:${product.productId}`;
        await this.queue.enqueue(
          'check-product',
          { storeId: product.storeId, productId: product.productId },
          { jobId, attempts: this.attempts, backoffMs: this.backoffMs },
        );
        enqueued += 1;
      }
      this.logger.info(
        { products: products.length, enqueued, at: this.clock.now().toISOString() },
        'scheduled product checks',
      );
    } catch (error) {
      this.logger.error({ error }, 'failed to schedule product checks');
    } finally {
      this.running = false;
    }
  }
}
