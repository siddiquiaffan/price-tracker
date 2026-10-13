import { type ProductData } from '../entities/product.js';
import { type Fetcher } from './fetcher.js';
import { type Logger } from './logger.js';

export interface ScrapeContext {
  fetcher: Fetcher;
  logger: Logger;
  signal?: AbortSignal;
  sessionId?: string;
}

/**
 * A pluggable e-commerce store. Adding a store = one folder + one registration
 * line in `stores/index.ts` (open/closed principle).
 */
export interface Store {
  /** Stable id, e.g. 'amazon'. Also the key used in egress store policy. */
  readonly id: string;
  readonly name: string;
  /** Hostnames this store owns (without `www.`), e.g. ['amazon.in', 'amzn.in']. */
  readonly hosts: readonly string[];
  matches(url: URL): boolean;
  /** Strip tracking params and return the canonical product URL. Idempotent. */
  normalizeUrl(url: URL): URL;
  /** Extract the store's product id; throws ParseError for non-product URLs. */
  extractProductId(url: URL): string;
  fetchProduct(url: URL, ctx: ScrapeContext): Promise<ProductData>;
}

export interface StoreRegistry {
  register(store: Store): void;
  /** Return the store for a URL, throwing UnsupportedStoreError if none match. */
  resolve(url: URL): Store;
  /** Return the matching store, or null. */
  find(url: URL): Store | null;
  list(): readonly Store[];
}
