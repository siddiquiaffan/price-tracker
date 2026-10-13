import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseAmazon } from '../../src/stores/amazon/parse.js';
import { parseFlipkart } from '../../src/stores/flipkart/parse.js';
import { ParseError } from '../../src/core/errors/app-error.js';

const here = dirname(fileURLToPath(import.meta.url));
const fixture = (store: 'amazon' | 'flipkart', name: string): string =>
  readFileSync(join(here, '..', 'fixtures', store, name), 'utf8');

const AMAZON_URL = new URL('https://www.amazon.in/dp/B07EXAMPLE');
const FLIPKART_URL = new URL('https://www.flipkart.com/example-fashion-item/p/itmexample');

describe('parseAmazon', () => {
  it('reads title, price, image and availability from JSON-LD', () => {
    const data = parseAmazon(fixture('amazon', 'in-stock-jsonld.html'), AMAZON_URL, 'B07EXAMPLE');
    expect(data.title).toBe('Example Wireless Headphones, Black');
    expect(data.price?.currency).toBe('INR');
    expect(data.price?.minorUnits).toBe(12999900);
    expect(data.imageUrl).toBe('https://m.media-amazon.com/images/I/example-headphones.jpg');
    expect(data.availability).toBe('in_stock');
    expect(data.productId).toBe('B07EXAMPLE');
  });

  it('falls back to CSS selectors when JSON-LD is absent', () => {
    const data = parseAmazon(fixture('amazon', 'in-stock-css.html'), AMAZON_URL, 'B07EXAMPLE');
    expect(data.title).toBe('Example Wireless Headphones, Black');
    expect(data.price?.minorUnits).toBe(12999900);
    expect(data.availability).toBe('in_stock');
    expect(data.imageUrl).toBe('https://m.media-amazon.com/images/I/example-headphones.jpg');
  });

  it('prefers the deal price when both deal and list prices exist', () => {
    const data = parseAmazon(fixture('amazon', 'deal-price.html'), AMAZON_URL, 'B07EXAMPLE');
    expect(data.price?.minorUnits).toBe(4599900);
    expect(data.availability).toBe('in_stock');
  });

  it('parses out-of-stock products with no price', () => {
    const data = parseAmazon(fixture('amazon', 'out-of-stock.html'), AMAZON_URL, 'B07EXAMPLE');
    expect(data.title).toBe('Example Sold Out Item');
    expect(data.price).toBeNull();
    expect(data.availability).toBe('out_of_stock');
  });

  it('returns a null price with unknown availability when the price is hidden', () => {
    const data = parseAmazon(fixture('amazon', 'no-price.html'), AMAZON_URL, 'B07EXAMPLE');
    expect(data.title).toBe('Example Item With No Visible Price');
    expect(data.price).toBeNull();
    expect(data.availability).toBe('unknown');
  });

  it('throws a ParseError on a captcha/robot page (no product title)', () => {
    expect(() => parseAmazon(fixture('amazon', 'captcha.html'), AMAZON_URL, 'B07EXAMPLE')).toThrow(
      ParseError,
    );
  });
});

describe('parseFlipkart', () => {
  it('reads title, price, image and availability from JSON-LD', () => {
    const data = parseFlipkart(
      fixture('flipkart', 'in-stock-jsonld.html'),
      FLIPKART_URL,
      'itmexample',
    );
    expect(data.title).toBe('Example Fashion Item');
    expect(data.price?.minorUnits).toBe(129900);
    expect(data.imageUrl).toBe('https://rukminim2.flixcart.com/image/example.jpg');
    expect(data.availability).toBe('in_stock');
  });

  it('falls back to CSS selectors when JSON-LD is absent', () => {
    const data = parseFlipkart(
      fixture('flipkart', 'in-stock-css.html'),
      FLIPKART_URL,
      'itmexample',
    );
    expect(data.title).toBe('Example Fashion Item');
    expect(data.price?.minorUnits).toBe(129900);
    expect(data.imageUrl).toBe('https://rukminim2.flixcart.com/image/example.jpg');
    expect(data.availability).toBe('in_stock');
  });

  it('parses out-of-stock items with no price', () => {
    const data = parseFlipkart(
      fixture('flipkart', 'out-of-stock.html'),
      FLIPKART_URL,
      'itmexample',
    );
    expect(data.title).toBe('Out of Stock Item');
    expect(data.price).toBeNull();
    expect(data.availability).toBe('out_of_stock');
  });

  it('returns a null price when no price is present', () => {
    const data = parseFlipkart(fixture('flipkart', 'no-price.html'), FLIPKART_URL, 'itmexample');
    expect(data.title).toBe('No Price Item');
    expect(data.price).toBeNull();
  });

  it('throws a ParseError on a captcha/robot page', () => {
    expect(() =>
      parseFlipkart(fixture('flipkart', 'captcha.html'), FLIPKART_URL, 'itmexample'),
    ).toThrow(ParseError);
  });
});
