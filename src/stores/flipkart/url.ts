import { ParseError } from '../../core/errors/app-error.js';

export const FLIPKART_HOSTS: readonly string[] = ['flipkart.com', 'fkrt.it', 'flipkart.net'];

function bareHost(hostname: string): string {
  return hostname.replace(/^www\./i, '').toLowerCase();
}

export function matchesFlipkartHost(hostname: string): boolean {
  const host = bareHost(hostname);
  return FLIPKART_HOSTS.some((known) => host === known || host.endsWith(`.${known}`));
}

const PATH_ITEM = /\/p\/(itm[0-9a-z]+)/i;

export function extractFlipkartProductId(url: URL): string {
  const pid = url.searchParams.get('pid');
  if (pid && pid.trim().length > 0) return pid.trim();
  const match = PATH_ITEM.exec(url.pathname);
  if (match?.[1]) return match[1].toUpperCase();
  throw new ParseError(`flipkart: no product id found in ${url.toString()}`);
}

/** Canonical, tracking-free product URL. Idempotent. */
export function normalizeFlipkartUrl(url: URL): URL {
  const pid = url.searchParams.get('pid');
  if (pid && pid.trim().length > 0) {
    return new URL(`https://www.flipkart.com/product/p/itme?pid=${encodeURIComponent(pid.trim())}`);
  }
  if (PATH_ITEM.test(url.pathname)) {
    return new URL(`https://www.flipkart.com${url.pathname}`);
  }
  return new URL(`${url.origin}${url.pathname}`);
}
