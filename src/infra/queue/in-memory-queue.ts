import { randomUUID } from 'node:crypto';
import { type Logger } from '../../core/ports/logger.js';
import {
  type EnqueueOptions,
  type Job,
  type JobHandler,
  type JobQueue,
  type ProcessOptions,
} from '../../core/ports/job-queue.js';

interface Registration {
  handler: JobHandler<unknown>;
  concurrency: number;
}

interface QueuedJob {
  job: Job<unknown>;
  options: EnqueueOptions;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    timer.unref?.();
  });
}

/**
 * Single-process job queue for dev/tests. Mirrors the BullMQ adapter's API so the
 * rest of the app cannot tell them apart. The port is async, but an in-memory
 * queue has nothing to await, hence the rule disables below.
 */
/* eslint-disable @typescript-eslint/require-await, @typescript-eslint/no-unnecessary-type-parameters */
export class InMemoryJobQueue implements JobQueue {
  private readonly registrations = new Map<string, Registration>();
  private readonly queues = new Map<string, QueuedJob[]>();
  private readonly active = new Map<string, number>();
  private readonly inFlight = new Set<string>();
  private readonly timers = new Set<NodeJS.Timeout>();
  private closed = false;

  constructor(private readonly logger?: Logger) {}

  private queueFor(name: string): QueuedJob[] {
    let queue = this.queues.get(name);
    if (!queue) {
      queue = [];
      this.queues.set(name, queue);
    }
    return queue;
  }

  async enqueue<T>(name: string, data: T, options: EnqueueOptions = {}): Promise<string> {
    if (this.closed) throw new Error('InMemoryJobQueue is closed');
    const id = options.jobId ?? randomUUID();
    const dedupeKey = `${name}:${id}`;
    if (options.jobId) {
      if (this.inFlight.has(dedupeKey)) return id;
      this.inFlight.add(dedupeKey);
    }

    const job: Job<unknown> = { id, name, data };
    const dispatch = (): void => {
      this.queueFor(name).push({ job, options });
      this.drain(name);
    };

    if (options.delayMs && options.delayMs > 0) {
      const timer = setTimeout(() => {
        this.timers.delete(timer);
        dispatch();
      }, options.delayMs);
      this.timers.add(timer);
    } else {
      dispatch();
    }

    return id;
  }

  async process<T>(
    name: string,
    handler: JobHandler<T>,
    options: ProcessOptions = {},
  ): Promise<void> {
    this.registrations.set(name, {
      handler: handler as JobHandler<unknown>,
      concurrency: options.concurrency ?? 1,
    });
    this.drain(name);
  }

  private drain(name: string): void {
    const registration = this.registrations.get(name);
    if (!registration || this.closed) return;
    const queue = this.queueFor(name);
    let active = this.active.get(name) ?? 0;

    while (!this.closed && active < registration.concurrency && queue.length > 0) {
      const item = queue.shift();
      if (!item) break;
      active += 1;
      this.active.set(name, active);
      void this.execute(name, registration, item).finally(() => {
        active -= 1;
        this.active.set(name, active);
        if (item.options.jobId) this.inFlight.delete(`${name}:${item.job.id}`);
        this.drain(name);
      });
    }
  }

  private async execute(name: string, registration: Registration, item: QueuedJob): Promise<void> {
    const attempts = Math.max(item.options.attempts ?? 1, 1);
    const backoffMs = item.options.backoffMs ?? 0;
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      try {
        await registration.handler(item.job);
        return;
      } catch (error) {
        if (attempt === attempts) {
          this.logger?.error({ error, jobName: name, jobId: item.job.id }, 'in-memory job failed');
          return;
        }
        if (backoffMs > 0) await delay(backoffMs * attempt);
      }
    }
  }

  async close(): Promise<void> {
    this.closed = true;
    for (const timer of this.timers) clearTimeout(timer);
    this.timers.clear();
    this.queues.clear();
  }
}
