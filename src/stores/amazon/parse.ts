import * as cheerio from 'cheerio';
import { Money } from '../../core/entities/money.js';
import { type Availability, type ProductData } from '../../core/entities/product.js';
import { ParseError } from '../../core/errors/app-error.js';
import { findJsonLdNode, firstString, offerField, type JsonObject } from '../json-ld.js';
import { collapseWhitespace, parseAvailability } from '../parse-utils.js';
import { amazonSelectors } from './selectors.js';
import { amazonDefaultCurrency } from './url.js';

function resolveCurrency(node: JsonObject | null, url: URL): string {
  const fromLd = offerField(node?.offers, 'priceCurrency');
  if (typeof fromLd === 'string' && /^[A-Z]{3}$/.test(fromLd.toUpperCase())) {
    return fromLd.toUpperCase();
  }
  return amazonDefaultCurrency(url.hostname);
}

function tryParsePrice(text: string | null | undefined, currency: string): Money | null {
  if (!text) return null;
  try {
    return Money.parse(text, currency);
  } catch {
    return null;
  }
}

function imageFromJsonLd(value: unknown): string | null {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) {
    const strings = value.filter((item): item is string => typeof item === 'string');
    return firstString(...strings);
  }
  return null;
}

/** Pure parse of an Amazon product page into ProductData. */
export function parseAmazon(html: string, url: URL, productId: string): ProductData {
  const $ = cheerio.load(html);
  const node = findJsonLdNode(html, 'Product');
  const currency = resolveCurrency(node, url);

  const title =
    firstString(node?.name) ??
    firstString(...amazonSelectors.title.map((selector) => $(selector).first().text()));

  if (!title) {
    throw new ParseError('amazon: product title not found');
  }

  let price: Money | null = null;
  const ldPrice = offerField(node?.offers, 'price');
  if (typeof ldPrice === 'string' || typeof ldPrice === 'number') {
    price = tryParsePrice(String(ldPrice), currency);
  }
  if (!price) {
    for (const selector of amazonSelectors.price) {
      price = tryParsePrice(collapseWhitespace($(selector).first().text()), currency);
      if (price) break;
    }
  }

  let availability: Availability = 'unknown';
  const ldAvailability = offerField(node?.offers, 'availability');
  if (typeof ldAvailability === 'string') {
    availability = parseAvailability(ldAvailability);
  }
  if (availability === 'unknown') {
    for (const selector of amazonSelectors.availability) {
      const text = collapseWhitespace($(selector).first().text());
      const parsed = parseAvailability(text);
      if (parsed !== 'unknown') {
        availability = parsed;
        break;
      }
    }
  }
  if (availability === 'unknown' && price) {
    availability = 'in_stock';
  }

  let imageUrl = imageFromJsonLd(node?.image);
  if (!imageUrl) {
    for (const selector of amazonSelectors.image) {
      const candidate = $(selector).attr('data-old-hires') ?? $(selector).attr('src');
      if (candidate && candidate.trim().length > 0) {
        imageUrl = candidate.trim();
        break;
      }
    }
  }

  return {
    storeId: 'amazon',
    productId,
    url: url.toString(),
    title: collapseWhitespace(title),
    price,
    imageUrl,
    availability,
  };
}
