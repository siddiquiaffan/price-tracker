export interface EnqueueOptions {
  /** Stable key so the same work is not enqueued twice concurrently. */
  jobId?: string;
  delayMs?: number;
  attempts?: number;
  backoffMs?: number;
}

export interface Job<T> {
  id: string;
  name: string;
  data: T;
}

export type JobHandler<T> = (job: Job<T>) => Promise<void>;

export interface ProcessOptions {
  concurrency?: number;
}

/**
 * Background job queue behind which BullMQ (production) and an in-memory adapter
 * (dev/tests) sit. Must be safe with multiple worker instances.
 *
 * The `T` parameters intentionally mirror the payload type for callers even
 * though each appears once in the signature.
 */
/* eslint-disable @typescript-eslint/no-unnecessary-type-parameters */
export interface JobQueue {
  enqueue<T>(name: string, data: T, options?: EnqueueOptions): Promise<string>;
  process<T>(name: string, handler: JobHandler<T>, options?: ProcessOptions): Promise<void>;
  close(): Promise<void>;
}
