import { describe, expect, it } from 'vitest';
import { InMemoryJobQueue } from '../src/infra/queue/in-memory-queue.js';
import { Scheduler } from '../src/scheduler/scheduler.js';
import { InMemoryProductRepository } from './helpers/repositories.js';
import { FakeClock } from './helpers/clock.js';
import { CapturingLogger } from './helpers/logger.js';
import { Money } from '../src/core/entities/money.js';

describe('InMemoryJobQueue', () => {
  it('delivers jobs to a registered handler', async () => {
    const queue = new InMemoryJobQueue();
    const received: { id: string; data: unknown }[] = [];
    await queue.process('work', (job) => {
      received.push({ id: job.id, data: job.data });
      return Promise.resolve();
    });
    await queue.enqueue('work', { n: 1 });
    await queue.enqueue('work', { n: 2 });

    // Give the microtask/queue drain a chance to run.
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(received).toHaveLength(2);
    expect(received[0]?.data).toEqual({ n: 1 });
  });

  it('de-duplicates jobs that share a jobId while one is pending', async () => {
    const queue = new InMemoryJobQueue();
    const received: unknown[] = [];
    await queue.process('work', async (job) => {
      received.push(job.data);
      await new Promise((resolve) => setTimeout(resolve, 5));
    });
    const first = await queue.enqueue('work', { n: 1 }, { jobId: 'same' });
    const second = await queue.enqueue('work', { n: 2 }, { jobId: 'same' });
    expect(first).toBe(second);

    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(received).toHaveLength(1);
  });

  it('rejects jobs after close', async () => {
    const queue = new InMemoryJobQueue();
    await queue.close();
    await expect(queue.enqueue('work', {})).rejects.toThrow();
  });
});

describe('Scheduler', () => {
  it('enqueues one check-product job per product with a stable job id', async () => {
    const queue = new InMemoryJobQueue();
    const products = new InMemoryProductRepository();
    const clock = new FakeClock();
    const now = clock.now();

    await products.upsert(
      {
        storeId: 'amazon',
        productId: 'A1',
        url: 'https://a.in/1',
        title: 'A1',
        price: Money.fromMinorUnits(100),
        imageUrl: null,
        availability: 'in_stock',
      },
      now,
    );
    await products.upsert(
      {
        storeId: 'flipkart',
        productId: 'F1',
        url: 'https://f.in/1',
        title: 'F1',
        price: Money.fromMinorUnits(200),
        imageUrl: null,
        availability: 'in_stock',
      },
      now,
    );

    const enqueued: {
      name: string;
      options?: { jobId?: string; attempts?: number; backoffMs?: number };
    }[] = [];
    queue.enqueue = (
      name: string,
      _data: unknown,
      options?: { jobId?: string; attempts?: number; backoffMs?: number },
    ) => {
      enqueued.push({ name, options: options ?? {} });
      return Promise.resolve(options?.jobId ?? String(enqueued.length));
    };

    const scheduler = new Scheduler({
      queue,
      products,
      intervalMs: 3_600_000,
      jitterRatio: 0,
      attempts: 2,
      backoffMs: 5_000,
      logger: new CapturingLogger(),
      clock,
    });
    await scheduler.run();

    expect(enqueued).toEqual([
      {
        name: 'check-product',
        options: { jobId: 'check:amazon:A1', attempts: 2, backoffMs: 5_000 },
      },
      {
        name: 'check-product',
        options: { jobId: 'check:flipkart:F1', attempts: 2, backoffMs: 5_000 },
      },
    ]);
  });

  it('skips a run while a previous run is in flight', async () => {
    const queue = new InMemoryJobQueue();
    const products = new InMemoryProductRepository();
    await products.upsert(
      {
        storeId: 'amazon',
        productId: 'A1',
        url: 'https://a.in/1',
        title: 'A1',
        price: Money.fromMinorUnits(100),
        imageUrl: null,
        availability: 'in_stock',
      },
      new Date('2024-01-01T00:00:00.000Z'),
    );
    const clock = new FakeClock();
    let inFlight = true;
    let calls = 0;
    queue.enqueue = async () => {
      calls += 1;
      while (inFlight) {
        await new Promise((resolve) => setTimeout(resolve, 1));
      }
      return String(calls);
    };

    const scheduler = new Scheduler({
      queue,
      products,
      intervalMs: 3_600_000,
      jitterRatio: 0,
      logger: new CapturingLogger(),
      clock,
    });

    const first = scheduler.run();
    const second = scheduler.run();
    inFlight = false;
    await Promise.all([first, second]);
    expect(calls).toBe(1);
  });
});
