import { type ScrapeContext, type Store } from '../core/ports/store.js';
import { type FetchOptions } from '../core/ports/fetcher.js';
import { type BlockDetector } from '../core/ports/block-detector.js';
import { type ProductData } from '../core/entities/product.js';
import { BlockDetectedError, ScrapeError } from '../core/errors/app-error.js';

export const DEFAULT_USER_AGENT =
  'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)';

export interface BaseStoreOptions {
  blockDetector?: BlockDetector;
  userAgent?: string;
}

/**
 * Shared scraping pipeline as a template method: normalize → fetch → block-detect
 * → parse → validate. Subclasses implement URL helpers and a pure `parse`.
 */
export abstract class BaseStore implements Store {
  abstract readonly id: string;
  abstract readonly name: string;
  abstract readonly hosts: readonly string[];

  protected readonly blockDetector: BlockDetector | undefined;
  protected readonly userAgent: string;

  constructor(options: BaseStoreOptions = {}) {
    this.blockDetector = options.blockDetector;
    this.userAgent = options.userAgent ?? DEFAULT_USER_AGENT;
  }

  abstract matches(url: URL): boolean;
  abstract normalizeUrl(url: URL): URL;
  abstract extractProductId(url: URL): string;

  /** Pure function of the fetched HTML and the canonical URL. */
  protected abstract parse(html: string, url: URL): ProductData;

  protected requestHeaders(): Record<string, string> {
    return {
      'user-agent': this.userAgent,
      accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'accept-language': 'en-IN,en;q=0.9',
    };
  }

  protected buildFetchOptions(ctx: ScrapeContext): FetchOptions {
    const options: FetchOptions = {};
    if (ctx.signal) options.signal = ctx.signal;
    if (ctx.sessionId) options.sessionId = ctx.sessionId;
    return options;
  }

  async fetchProduct(url: URL, ctx: ScrapeContext): Promise<ProductData> {
    const normalized = this.normalizeUrl(url);
    const response = await ctx.fetcher.fetch(
      {
        url: normalized,
        method: 'GET',
        headers: this.requestHeaders(),
        storeId: this.id,
      },
      this.buildFetchOptions(ctx),
    );

    if (
      this.blockDetector?.isBlocked({
        status: response.status,
        body: response.body,
        headers: response.headers,
      })
    ) {
      throw new BlockDetectedError(`${this.id}: blocked page detected (status ${response.status})`);
    }

    if (response.status >= 400) {
      throw new ScrapeError(`${this.id}: unexpected response status ${response.status}`);
    }

    return this.parse(response.body, normalized);
  }
}
