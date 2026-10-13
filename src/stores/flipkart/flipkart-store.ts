import { type ProductData } from '../../core/entities/product.js';
import { BaseStore } from '../base-store.js';
import { parseFlipkart } from './parse.js';
import {
  FLIPKART_HOSTS,
  extractFlipkartProductId,
  matchesFlipkartHost,
  normalizeFlipkartUrl,
} from './url.js';

/** Flipkart store plugin. */
export class FlipkartStore extends BaseStore {
  readonly id = 'flipkart';
  readonly name = 'Flipkart';
  readonly hosts = FLIPKART_HOSTS;

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
