import { describe, expect, it } from 'vitest';
import { UrlResolver, type UrlResolverOptions } from '../src/core/services/url-resolver.js';
import { ScrapeError } from '../src/core/errors/app-error.js';
import { FakeFetcher } from './helpers/fetcher.js';
import { CapturingLogger } from './helpers/logger.js';

function createResolver(fetcher: FakeFetcher, isProductUrl?: (url: URL) => boolean): UrlResolver {
  const options: UrlResolverOptions = {
    fetcher,
    maxRedirects: 5,
    timeoutMs: 500,
    logger: new CapturingLogger(),
  };
  if (isProductUrl !== undefined) options.isProductUrl = isProductUrl;
  return new UrlResolver(options);
}

describe('UrlResolver', () => {
  it('adds https:// when the scheme is missing', async () => {
    const fetcher = new FakeFetcher();
    const resolver = createResolver(fetcher, () => true);
    await expect(resolver.resolve('www.amazon.in/dp/B00EXAMPLE')).resolves.toMatchObject({
      protocol: 'https:',
      hostname: 'www.amazon.in',
    });
  });

  it('does not fetch when the URL is already a product page', async () => {
    const fetcher = new FakeFetcher();
    const resolver = createResolver(fetcher, () => true);
    const resolved = await resolver.resolve('https://www.amazon.in/dp/B00EXAMPLE');
    expect(resolved.toString()).toBe('https://www.amazon.in/dp/B00EXAMPLE');
    expect(fetcher.requests).toHaveLength(0);
  });

  it('follows redirect hops via Location headers', async () => {
    const fetcher = new FakeFetcher();
    fetcher.when('https://amzn.in/shortlink', {
      status: 302,
      headers: { location: 'https://www.amazon.in/dp/B00REDIRECT' },
    });
    const resolver = createResolver(fetcher);
    const resolved = await resolver.resolve('https://amzn.in/shortlink');
    expect(resolved.hostname).toBe('www.amazon.in');
    // One request for the short link, one for the redirect target.
    expect(fetcher.requests).toHaveLength(2);
  });

  it('stops at the first non-3xx response', async () => {
    const fetcher = new FakeFetcher();
    fetcher.when('https://amzn.in/shortlink', { status: 200, body: '<html>page</html>' });
    const resolver = createResolver(fetcher);
    const resolved = await resolver.resolve('https://amzn.in/shortlink');
    expect(resolved.toString()).toBe('https://amzn.in/shortlink');
  });

  it('throws when the redirect chain exceeds the limit', async () => {
    const fetcher = new FakeFetcher();
    fetcher.handler = () => ({ status: 302, headers: { location: 'https://example.com/loop' } });
    const resolver = createResolver(fetcher);
    await expect(resolver.resolve('https://example.com/start')).rejects.toBeInstanceOf(ScrapeError);
  });

  it('throws for garbage input', async () => {
    const fetcher = new FakeFetcher();
    const resolver = createResolver(fetcher);
    await expect(resolver.resolve('https://')).rejects.toThrow();
  });
});
