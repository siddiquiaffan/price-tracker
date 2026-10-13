import { type ProductData } from '../../core/entities/product.js';
import { BaseStore } from '../base-store.js';
import { parseAmazon } from './parse.js';
import {
  extractAmazonProductId,
  matchesAmazonHost,
  AMAZON_HOSTS,
  normalizeAmazonUrl,
} from './url.js';

/** Amazon store plugin. Only `parse` and URL helpers are store-specific. */
export class AmazonStore extends BaseStore {
  readonly id = 'amazon';
  readonly name = 'Amazon';
  readonly hosts = AMAZON_HOSTS;

  matches(url: URL): boolean {
    return matchesAmazonHost(url.hostname);
  }

  normalizeUrl(url: URL): URL {
    return normalizeAmazonUrl(url);
  }

  extractProductId(url: URL): string {
    return extractAmazonProductId(url);
  }

  protected parse(html: string, url: URL): ProductData {
    return parseAmazon(html, url, extractAmazonProductId(url));
  }
}
