import { InvalidUrlError, ScrapeError } from '../errors/app-error.js';
import { type Fetcher } from '../ports/fetcher.js';
import { type HostResolver } from '../ports/host-resolver.js';
import { type Logger } from '../ports/logger.js';
import { assertSafeResolvedAddresses, assertSafeUrl } from './ssrf.js';

export interface UrlResolverOptions {
  fetcher: Fetcher;
  hostResolver?: HostResolver;
  maxRedirects?: number;
  timeoutMs?: number;
  logger?: Logger;
  /** Return true when the URL already points at a product page (skip expansion). */
  isProductUrl?: (url: URL) => boolean;
}

function parseInput(raw: string): URL {
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    throw new InvalidUrlError('Empty URL');
  }
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  try {
    return new URL(withScheme);
  } catch {
    throw new InvalidUrlError(`Cannot parse URL: ${raw}`);
  }
}

/**
 * Expands short links and validates user-supplied URLs. Enforces the SSRF guard
 * on the initial URL, every redirect hop, and (when a resolver is provided) the
 * resolved IP addresses.
 */
export class UrlResolver {
  private readonly fetcher: Fetcher;
  private readonly hostResolver: HostResolver | undefined;
  private readonly maxRedirects: number;
  private readonly timeoutMs: number;
  private readonly logger: Logger | undefined;
  private readonly isProductUrl: ((url: URL) => boolean) | undefined;

  constructor(options: UrlResolverOptions) {
    this.fetcher = options.fetcher;
    this.hostResolver = options.hostResolver;
    this.maxRedirects = options.maxRedirects ?? 5;
    this.timeoutMs = options.timeoutMs ?? 10_000;
    this.logger = options.logger;
    this.isProductUrl = options.isProductUrl;
  }

  private async assertSafe(url: URL): Promise<void> {
    assertSafeUrl(url);
    if (this.hostResolver) {
      const addresses = await this.hostResolver.resolve(url.hostname);
      assertSafeResolvedAddresses(url.hostname, addresses);
    }
  }

  async resolve(raw: string): Promise<URL> {
    let current = parseInput(raw);
    await this.assertSafe(current);

    if (this.isProductUrl?.(current)) {
      return current;
    }

    const controller = new AbortController();
    const timer = setTimeout(() => {
      controller.abort();
    }, this.timeoutMs);
    try {
      for (let hop = 0; hop <= this.maxRedirects; hop += 1) {
        const response = await this.fetcher.fetch(
          {
            url: current,
            method: 'GET',
            headers: {
              'user-agent':
                'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
            },
          },
          { signal: controller.signal },
        );

        if (response.status >= 300 && response.status < 400) {
          const location = response.headers.location;
          if (!location) return current;
          current = new URL(location, current);
          await this.assertSafe(current);
          continue;
        }
        return current;
      }
    } finally {
      clearTimeout(timer);
    }

    this.logger?.warn(
      { url: current.toString(), maxRedirects: this.maxRedirects },
      'redirect limit reached',
    );
    throw new ScrapeError('Too many redirects while resolving URL');
  }
}
