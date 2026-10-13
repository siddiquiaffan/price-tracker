import * as cheerio from 'cheerio';
import { Money } from '../../core/entities/money.js';
import { type Availability, type ProductData } from '../../core/entities/product.js';
import { ParseError } from '../../core/errors/app-error.js';
import { findJsonLdNode, firstString, offerField } from '../json-ld.js';
import { collapseWhitespace, parseAvailability } from '../parse-utils.js';
import { flipkartSelectors } from './selectors.js';

function tryParsePrice(text: string | null | undefined, currency: string): Money | null {
  if (!text) return null;
  try {
    return Money.parse(text, currency);
  } catch {
    return null;
  }
}

/** Pure parse of a Flipkart product page into ProductData. */
export function parseFlipkart(html: string, url: URL, productId: string): ProductData {
  const $ = cheerio.load(html);
  const node = findJsonLdNode(html, 'Product');

  const ldCurrency = offerField(node?.offers, 'priceCurrency');
  const currency =
    typeof ldCurrency === 'string' && /^[A-Z]{3}$/i.test(ldCurrency)
      ? ldCurrency.toUpperCase()
      : 'INR';

  const title =
    firstString(node?.name) ??
    firstString($('meta[property="og:title"]').attr('content')) ??
    firstString(...flipkartSelectors.title.map((selector) => $(selector).first().text()));

  if (!title) {
    throw new ParseError('flipkart: product title not found');
  }

  let price: Money | null = null;
  const ldPrice = offerField(node?.offers, 'price');
  if (typeof ldPrice === 'string' || typeof ldPrice === 'number') {
    price = tryParsePrice(String(ldPrice), currency);
  }
  price ??= tryParsePrice($('meta[property="product:price:amount"]').attr('content'), currency);
  price ??= tryParsePrice($('meta[property="og:price:amount"]').attr('content'), currency);
  if (!price) {
    for (const selector of flipkartSelectors.price) {
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
    const metaAvailability = $('meta[property="product:availability"]').attr('content');
    availability = parseAvailability(metaAvailability);
  }
  if (availability === 'unknown') {
    for (const selector of flipkartSelectors.availability) {
      const parsed = parseAvailability(collapseWhitespace($(selector).first().text()));
      if (parsed !== 'unknown') {
        availability = parsed;
        break;
      }
    }
  }
  if (availability === 'unknown' && price) {
    availability = 'in_stock';
  }

  let imageUrl = firstString($('meta[property="og:image"]').attr('content'));
  if (!imageUrl) {
    for (const selector of flipkartSelectors.image) {
      const candidate = $(selector).attr('src');
      if (candidate && candidate.trim().length > 0) {
        imageUrl = candidate.trim();
        break;
      }
    }
  }

  return {
    storeId: 'flipkart',
    productId,
    url: url.toString(),
    title: collapseWhitespace(title),
    price,
    imageUrl,
    availability,
  };
}
