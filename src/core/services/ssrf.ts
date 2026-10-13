import { NotAllowedError } from '../errors/app-error.js';

const ALLOWED_PROTOCOLS = new Set(['http:', 'https:']);

function ipv4ToInt(address: string): number | null {
  const parts = address.split('.');
  if (parts.length !== 4) return null;
  let value = 0;
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null;
    const octet = Number(part);
    if (octet > 255) return null;
    value = value * 256 + octet;
  }
  return value;
}

function inCidr(value: number, base: string, prefix: number): boolean {
  const baseValue = ipv4ToInt(base);
  if (baseValue === null) return false;
  const mask = prefix === 0 ? 0 : (~0 << (32 - prefix)) >>> 0;
  return (value & mask) === (baseValue & mask);
}

const PRIVATE_V4_RANGES: readonly [string, number][] = [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
];

function isPrivateIpv4(address: string): boolean {
  const value = ipv4ToInt(address);
  if (value === null) return false;
  return PRIVATE_V4_RANGES.some(([base, prefix]) => inCidr(value, base, prefix));
}

/** Also catches decimal (2130706433) and hex (0x7f000001) encodings of an IP. */
function parseIpv4Like(hostname: string): string | null {
  if (/^\d+$/.test(hostname)) {
    const value = Number(hostname);
    if (!Number.isFinite(value) || value < 0 || value > 0xffffffff) return null;
    return [(value >>> 24) & 255, (value >>> 16) & 255, (value >>> 8) & 255, value & 255].join('.');
  }
  if (/^0x[0-9a-f]+$/i.test(hostname)) {
    const value = Number.parseInt(hostname, 16);
    if (!Number.isFinite(value) || value < 0 || value > 0xffffffff) return null;
    return [(value >>> 24) & 255, (value >>> 16) & 255, (value >>> 8) & 255, value & 255].join('.');
  }
  if (/^[0-9a-f:]+$/i.test(hostname) && hostname.includes(':')) {
    return null; // let IPv6 handling deal with it
  }
  return null;
}

function isPrivateIpv6(address: string): boolean {
  const host = address.replace(/^\[|\]$/g, '').toLowerCase();
  if (host === '::1' || host === '::') return true;
  // IPv4-mapped (::ffff:a.b.c.d)
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/.exec(host);
  if (mapped?.[1]) return isPrivateIpv4(mapped[1]);
  // Unique-local fc00::/7 and link-local fe80::/10
  if (/^f[cd][0-9a-f]{2}:/.test(host)) return true;
  if (/^fe[89ab][0-9a-f]:/.test(host)) return true;
  return false;
}

export function isPrivateAddress(address: string): boolean {
  const host = address.replace(/^\[|\]$/g, '');
  const mapped = parseIpv4Like(host);
  if (mapped) return isPrivateIpv4(mapped);
  if (host.includes(':')) return isPrivateIpv6(host);
  return isPrivateIpv4(host);
}

const BLOCKED_HOST_SUFFIXES = ['.localhost', '.local', '.internal', '.home.arpa'];

export function isBlockedHostname(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/\.$/, '');
  if (host === '' || host === 'localhost') return true;
  if (BLOCKED_HOST_SUFFIXES.some((suffix) => host.endsWith(suffix))) return true;
  return isPrivateAddress(host);
}

export function assertAllowedProtocol(url: URL): void {
  if (!ALLOWED_PROTOCOLS.has(url.protocol)) {
    throw new NotAllowedError(`Blocked non-HTTP(S) URL scheme: ${url.protocol}`);
  }
}

/** Throws when the URL targets a non-public address or a disallowed scheme. */
export function assertSafeUrl(url: URL): void {
  assertAllowedProtocol(url);
  if (isBlockedHostname(url.hostname)) {
    throw new NotAllowedError(`Blocked request to private/internal host: ${url.hostname}`);
  }
}

/** Apply URL safety checks to every resolved IP to defeat DNS rebinding. */
export function assertSafeResolvedAddresses(hostname: string, addresses: readonly string[]): void {
  for (const address of addresses) {
    if (isPrivateAddress(address)) {
      throw new NotAllowedError(
        `Blocked request to private/internal address: ${hostname} -> ${address}`,
      );
    }
  }
}
