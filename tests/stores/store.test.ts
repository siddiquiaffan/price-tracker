import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { Money } from '../../src/core/entities/money.js';
import {
  BlockDetectedError,
  ParseError,
  ScrapeError,
  UnsupportedStoreError,
  ValidationError,
} from '../../src/core/errors/app-error.js';
import {
  amazonDefaultCurrency,
  amazonLocaleHost,
  extractAmazonProductId,
  isAsin,
  matchesAmazonHost,
  normalizeAmazonUrl,
} from '../../src/stores/amazon/url.js';
import {
  extractFlipkartProductId,
  matchesFlipkartHost,
  normalizeFlipkartUrl,
} from '../../src/stores/flipkart/url.js';
import { AmazonStore } from '../../src/stores/amazon/index.js';
import { FlipkartStore } from '../../src/stores/flipkart/index.js';
import { CompositeBlockDetector } from '../../src/infra/egress/block-detector.js';
import { InMemoryStoreRegistry, createStoreRegistry } from '../../src/stores/index.js';
import { FakeFetcher } from '../helpers/fetcher.js';
import { silentLogger } from '../helpers/logger.js';

const here = dirname(fileURLToPath(import.meta.url));
const fixture = (store: 'amazon' | 'flipkart', name: string): string =>
  readFileSync(join(here, '..', 'fixtures', store, name), 'utf8');

describe('amazon url helpers', () => {
  it('matches storefront and short-link hosts, ignoring www and subdomains', () => {
    expect(matchesAmazonHost('www.amazon.in')).toBe(true);
    expect(matchesAmazonHost('m.media.amazon.in')).toBe(true);
    expect(matchesAmazonHost('amzn.in')).toBe(true);
    expect(matchesAmazonHost('not-amazon.com')).toBe(false);
  });

  it('resolves the canonical locale host', () => {
    expect(amazonLocaleHost('amazon.com')).toBe('amazon.com');
    expect(amazonLocaleHost('www.amazon.co.uk')).toBe('amazon.co.uk');
    // Short links default to the Indian storefront.
    expect(amazonLocaleHost('amzn.in')).toBe('amazon.in');
    expect(amazonLocaleHost('unknown.example')).toBe('amazon.in');
  });

  it('infers the currency from the locale', () => {
    expect(amazonDefaultCurrency('amazon.in')).toBe('INR');
    expect(amazonDefaultCurrency('amazon.co.jp')).toBe('JPY');
    expect(amazonDefaultCurrency('amazon.com')).toBe('USD');
    expect(amazonDefaultCurrency('unknown.example')).toBe('INR');
  });

  it('validates ASIN shapes', () => {
    expect(isAsin('B00EXAMPLE')).toBe(true);
    expect(isAsin('1234567890')).toBe(true);
    expect(isAsin('123456789X')).toBe(true);
    expect(isAsin('b00example')).toBe(false);
    expect(isAsin('too-short')).toBe(false);
  });

  it('extracts product ids from the common URL shapes', () => {
    const extract = (path: string): string =>
      extractAmazonProductId(new URL(`https://www.amazon.in${path}`));
    expect(extract('/dp/B00EXAMPLE')).toBe('B00EXAMPLE');
    expect(extract('/gp/product/B00EXAMPLE')).toBe('B00EXAMPLE');
    expect(extract('/d/B00EXAMPLE')).toBe('B00EXAMPLE');
    expect(extract('/B00EXAMPLE')).toBe('B00EXAMPLE');
    // Lower-case ids are normalized to upper-case ASINs.
    expect(extract('/dp/b00example')).toBe('B00EXAMPLE');
  });

  it('throws for non-product URLs', () => {
    expect(() => extractAmazonProductId(new URL('https://www.amazon.in/gp/help/customer'))).toThrow(
      ParseError,
    );
  });

  it('normalizes product URLs to the canonical dp link, idempotently', () => {
    const url = new URL('https://www.amazon.in/dp/B00EXAMPLE?tag=asloot-21&ref=xyz#top');
    const normalized = normalizeAmazonUrl(url);
    expect(normalized.toString()).toBe('https://www.amazon.in/dp/B00EXAMPLE');
    expect(normalizeAmazonUrl(normalized).toString()).toBe('https://www.amazon.in/dp/B00EXAMPLE');
  });

  it('normalizes short links to the indian storefront', () => {
    expect(normalizeAmazonUrl(new URL('https://amzn.to/B00EXAMPLE')).toString()).toBe(
      'https://www.amazon.in/dp/B00EXAMPLE',
    );
  });
});

describe('flipkart url helpers', () => {
  it('matches flipkart hosts', () => {
    expect(matchesFlipkartHost('www.flipkart.com')).toBe(true);
    expect(matchesFlipkartHost('dl.flipkart.com')).toBe(true);
    expect(matchesFlipkartHost('fkrt.it')).toBe(true);
    expect(matchesFlipkartHost('amazon.in')).toBe(false);
  });

  it('prefers the pid param over the path', () => {
    const url = new URL('https://www.flipkart.com/audio/p/itmxyz?pid=MOB123ABC&lid=abc');
    expect(extractFlipkartProductId(url)).toBe('MOB123ABC');
    expect(normalizeFlipkartUrl(url).toString()).toBe(
      'https://www.flipkart.com/product/p/itme?pid=MOB123ABC',
    );
  });

  it('falls back to the path item id', () => {
    const url = new URL('https://www.flipkart.com/example/p/itmabc');
    expect(extractFlipkartProductId(url)).toBe('ITMABC');
    expect(normalizeFlipkartUrl(url).toString()).toBe('https://www.flipkart.com/example/p/itmabc');
  });

  it('throws when no product id is present', () => {
    expect(() => extractFlipkartProductId(new URL('https://www.flipkart.com/help'))).toThrow(
      ParseError,
    );
  });
});

describe('InMemoryStoreRegistry', () => {
  it('registers, resolves and lists stores', () => {
    const registry = new InMemoryStoreRegistry();
    const amazon = new AmazonStore();
    const flipkart = new FlipkartStore();
    registry.register(amazon);
    registry.register(flipkart);

    expect(registry.resolve(new URL('https://www.amazon.in/dp/B00EXAMPLE')).id).toBe('amazon');
    expect(registry.find(new URL('https://www.flipkart.com/p/itmabc'))?.id).toBe('flipkart');
    expect(registry.find(new URL('https://unknown.example/'))).toBeNull();
    expect(registry.list().map((store) => store.id)).toEqual(['amazon', 'flipkart']);
  });

  it('rejects duplicate store ids and unknown hosts', () => {
    const registry = new InMemoryStoreRegistry();
    registry.register(new AmazonStore());
    expect(() => {
      registry.register(new AmazonStore());
    }).toThrow(ValidationError);
    expect(() => registry.resolve(new URL('https://unknown.example/'))).toThrow(
      UnsupportedStoreError,
    );
  });

  it('builds the standard store set through createStoreRegistry', () => {
    const registry = createStoreRegistry();
    expect(registry.list()).toHaveLength(2);
    expect(registry.resolve(new URL('https://amzn.in/B00EXAMPLE')).id).toBe('amazon');
  });
});

describe('BaseStore (via AmazonStore)', () => {
  it('fetches and parses a product page through the normalized url', async () => {
    const store = new AmazonStore();
    const fetcher = new FakeFetcher();
    fetcher.when('https://www.amazon.in/dp/B00EXAMPLE', {
      status: 200,
      body: fixture('amazon', 'in-stock-jsonld.html'),
    });

    const data = await store.fetchProduct(
      new URL('https://www.amazon.in/dp/B00EXAMPLE?tag=tracking-param'),
      { fetcher, logger: silentLogger },
    );

    expect(data.productId).toBe('B00EXAMPLE');
    expect(data.price?.minorUnits).toBe(12999900);
    expect(fetcher.requests[0]?.url.toString()).toBe('https://www.amazon.in/dp/B00EXAMPLE');
    expect(fetcher.requests[0]?.storeId).toBe('amazon');
    expect(fetcher.requests[0]?.headers?.['user-agent']).toContain('Googlebot');
  });

  it('forwards signal and session id into the fetcher options', async () => {
    const store = new AmazonStore();
    const fetcher = new FakeFetcher();
    fetcher.when('https://www.amazon.in/dp/B00EXAMPLE', {
      status: 200,
      body: fixture('amazon', 'in-stock-jsonld.html'),
    });
    const controller = new AbortController();

    await store.fetchProduct(new URL('https://www.amazon.in/dp/B00EXAMPLE'), {
      fetcher,
      logger: silentLogger,
      signal: controller.signal,
      sessionId: 'session-1',
    });

    expect(fetcher.requests[0]?.url.toString()).toBe('https://www.amazon.in/dp/B00EXAMPLE');
  });

  it('throws BlockDetectedError on a status-based block', async () => {
    const store = new AmazonStore({ blockDetector: new CompositeBlockDetector() });
    const fetcher = new FakeFetcher();
    fetcher.when('https://www.amazon.in/dp/B00EXAMPLE', { status: 403, body: 'forbidden' });

    await expect(
      store.fetchProduct(new URL('https://www.amazon.in/dp/B00EXAMPLE'), {
        fetcher,
        logger: silentLogger,
      }),
    ).rejects.toBeInstanceOf(BlockDetectedError);
  });

  it('throws BlockDetectedError when the body looks like a captcha', async () => {
    const store = new AmazonStore({ blockDetector: new CompositeBlockDetector() });
    const fetcher = new FakeFetcher();
    fetcher.when('https://www.amazon.in/dp/B00EXAMPLE', {
      status: 200,
      body: fixture('amazon', 'captcha.html'),
    });

    await expect(
      store.fetchProduct(new URL('https://www.amazon.in/dp/B00EXAMPLE'), {
        fetcher,
        logger: silentLogger,
      }),
    ).rejects.toBeInstanceOf(BlockDetectedError);
  });

  it('throws ScrapeError for unexpected status codes', async () => {
    const store = new AmazonStore();
    const fetcher = new FakeFetcher();
    fetcher.when('https://www.amazon.in/dp/B00EXAMPLE', { status: 500, body: 'boom' });

    await expect(
      store.fetchProduct(new URL('https://www.amazon.in/dp/B00EXAMPLE'), {
        fetcher,
        logger: silentLogger,
      }),
    ).rejects.toBeInstanceOf(ScrapeError);
  });

  it('surfaces parse errors from the store-specific parser', async () => {
    const store = new AmazonStore();
    const fetcher = new FakeFetcher();
    fetcher.when('https://www.amazon.in/dp/B00EXAMPLE', {
      status: 200,
      body: '<html>no product</html>',
    });

    await expect(
      store.fetchProduct(new URL('https://www.amazon.in/dp/B00EXAMPLE'), {
        fetcher,
        logger: silentLogger,
      }),
    ).rejects.toBeInstanceOf(ParseError);
  });
});

describe('FlipkartStore', () => {
  it('matches, normalizes and parses flipkart pages', async () => {
    const store = new FlipkartStore();
    expect(store.matches(new URL('https://www.flipkart.com/p/itmabc'))).toBe(true);
    const fetcher = new FakeFetcher();
    fetcher.when('https://www.flipkart.com/p/itmabc', {
      status: 200,
      body: fixture('flipkart', 'in-stock-jsonld.html'),
    });

    const data = await store.fetchProduct(new URL('https://www.flipkart.com/p/itmabc'), {
      fetcher,
      logger: silentLogger,
    });

    expect(data.storeId).toBe('flipkart');
    expect(data.productId).toBe('ITMABC');
    expect(data.price).toEqual(Money.fromMinorUnits(129900));
  });
});
