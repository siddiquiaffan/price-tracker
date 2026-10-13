import { ParseError } from '../../core/errors/app-error.js';

/** Full Amazon storefronts (canonical hosts). */
const FULL_HOSTS = [
  'amazon.in',
  'amazon.com',
  'amazon.co.uk',
  'amazon.ae',
  'amazon.ca',
  'amazon.de',
  'amazon.fr',
  'amazon.es',
  'amazon.it',
  'amazon.nl',
  'amazon.se',
  'amazon.com.au',
  'amazon.com.br',
  'amazon.com.mx',
  'amazon.sg',
  'amazon.co.jp',
] as const;

/** Short-link domains that redirect to a product page. */
const SHORT_HOSTS = ['amzn.in', 'amzn.to', 'amzn.eu', 'a.co', 'amzn.asia'] as const;

export const AMAZON_HOSTS: readonly string[] = [...FULL_HOSTS, ...SHORT_HOSTS];

const CURRENCY_BY_HOST: Readonly<Record<string, string>> = {
  'amazon.in': 'INR',
  'amazon.com': 'USD',
  'amazon.co.uk': 'GBP',
  'amazon.ae': 'AED',
  'amazon.ca': 'CAD',
  'amazon.de': 'EUR',
  'amazon.fr': 'EUR',
  'amazon.es': 'EUR',
  'amazon.it': 'EUR',
  'amazon.nl': 'EUR',
  'amazon.com.au': 'AUD',
  'amazon.com.br': 'BRL',
  'amazon.com.mx': 'MXN',
  'amazon.sg': 'SGD',
  'amazon.co.jp': 'JPY',
};

function bareHost(hostname: string): string {
  return hostname.replace(/^www\./i, '').toLowerCase();
}

export function matchesAmazonHost(hostname: string): boolean {
  const host = bareHost(hostname);
  return AMAZON_HOSTS.some((known) => host === known || host.endsWith(`.${known}`));
}

/** The canonical storefront host for a URL (defaults to amazon.in for short links). */
export function amazonLocaleHost(hostname: string): string {
  const host = bareHost(hostname);
  return FULL_HOSTS.find((known) => host === known || host.endsWith(`.${known}`)) ?? 'amazon.in';
}

export function amazonDefaultCurrency(hostname: string): string {
  return CURRENCY_BY_HOST[amazonLocaleHost(hostname)] ?? 'INR';
}

export function isAsin(value: string): boolean {
  return /^(B[0-9A-Z]{9}|[0-9]{9}[0-9X])$/.test(value);
}

const PATH_PATTERNS: readonly RegExp[] = [
  /\/dp\/([A-Z0-9]{10})(?:[/?]|$)/i,
  /\/gp\/product\/([A-Z0-9]{10})(?:[/?]|$)/i,
  /\/(?:d|product|o|aw\/d)\/([A-Z0-9]{10})(?:[/?]|$)/i,
  /\/dp%2F([A-Z0-9]{10})/i,
];

/** Extract the ASIN from any common Amazon URL shape; throws ParseError otherwise. */
export function extractAmazonProductId(url: URL): string {
  const path = decodeURIComponent(url.pathname);
  for (const pattern of PATH_PATTERNS) {
    const match = pattern.exec(path);
    const candidate = match?.[1]?.toUpperCase();
    if (candidate && isAsin(candidate)) return candidate;
  }
  // Bare ASIN as the final path segment.
  const segments = path.split('/').filter(Boolean);
  const last = segments[segments.length - 1]?.toUpperCase();
  if (last && isAsin(last)) return last;
  throw new ParseError(`amazon: no product id found in ${url.toString()}`);
}

/** Canonical, tracking-free product URL. Idempotent. */
export function normalizeAmazonUrl(url: URL): URL {
  const asin = extractAmazonProductId(url);
  const host = amazonLocaleHost(url.hostname);
  return new URL(`https://www.${host}/dp/${asin}`);
}
