import { type ProductData } from '../../core/entities/product.js';
import { BaseStore, type BaseStoreOptions } from '../base-store.js';
import { parseFlipkart } from './parse.js';
import {
  FLIPKART_HOSTS,
  extractFlipkartProductId,
  matchesFlipkartHost,
  normalizeFlipkartUrl,
} from './url.js';

/**
 * Desktop-browser UA. Flipkart serves 200-status challenge pages to the
 * generic Googlebot UA from plain IPs (verified live: ~50% challenged), but
 * a browser fingerprint gets the real page. Still overridable per store via
 * `BaseStoreOptions.userAgent`.
 */
export const FLIPKART_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

/** Flipkart store plugin. */
export class FlipkartStore extends BaseStore {
  readonly id = 'flipkart';
  readonly name = 'Flipkart';
  readonly hosts = FLIPKART_HOSTS;

  constructor(options: BaseStoreOptions = {}) {
    super({ ...options, userAgent: options.userAgent ?? FLIPKART_USER_AGENT });
  }

  matches(url: URL): boolean {
    return matchesFlipkartHost(url.hostname);
  }

  normalizeUrl(url: URL): URL {
    return normalizeFlipkartUrl(url);
  }

  extractProductId(url: URL): string {
    return extractFlipkartProductId(url);
  }

  protected parse(html: string, url: URL): ProductData {
    return parseFlipkart(html, url, extractFlipkartProductId(url));
  }
}
