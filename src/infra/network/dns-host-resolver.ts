import { lookup } from 'node:dns/promises';
import { type HostResolver } from '../../core/ports/host-resolver.js';

/** Resolves hostnames via the system resolver (used by the SSRF guard). */
export class DnsHostResolver implements HostResolver {
  async resolve(hostname: string): Promise<string[]> {
    const records = await lookup(hostname, { all: true });
    return records.map((record) => record.address);
  }
}
