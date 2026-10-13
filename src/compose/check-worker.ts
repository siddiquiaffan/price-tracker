import { type JobQueue } from '../core/ports/job-queue.js';
import { type Logger } from '../core/ports/logger.js';
import { type ProductRepository } from '../core/ports/repositories.js';
import { type PriceCheckService } from '../core/services/price-check-service.js';

export interface CheckProductJobData {
  storeId: string;
  productId: string;
}

export interface CheckWorkerOptions {
  queue: JobQueue;
  products: ProductRepository;
  priceCheck: PriceCheckService;
  concurrency?: number;
  logger: Logger;
}

/**
 * Registers the `check-product` job handler. Runs in the API process (in-memory
 * queue) or as separate worker instances (BullMQ). The price-check service
 * deduplicates concurrent checks in-process; BullMQ's locks handle cross-instance.
 */
export async function startCheckWorker(options: CheckWorkerOptions): Promise<void> {
  const { queue, products, priceCheck, logger } = options;
  await queue.process(
    'check-product',
    async (job) => {
      const data = job.data as CheckProductJobData;
      const product = await products.findByKey({
        storeId: data.storeId,
        productId: data.productId,
      });
      if (!product) {
        logger.warn({ ...data }, 'check job references a missing product; skipping');
        return;
      }
      const result = await priceCheck.checkProduct(product);
      if (result.changed) {
        logger.info({ ...data, changed: true, notified: result.notified }, 'product price changed');
      }
    },
    { concurrency: options.concurrency ?? 5 },
  );
}
