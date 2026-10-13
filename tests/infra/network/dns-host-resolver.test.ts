import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockLookup = vi.fn<(...args: unknown[]) => Promise<unknown>>();

vi.mock('node:dns/promises', () => ({
  lookup: (...args: unknown[]) => mockLookup(...args),
}));

import { DnsHostResolver } from '../../../src/infra/network/dns-host-resolver.js';

describe('DnsHostResolver', () => {
  beforeEach(() => {
    mockLookup.mockReset();
  });

  it('maps lookup records to a plain address array', async () => {
    mockLookup.mockResolvedValue([
      { address: '127.0.0.1', family: 4 },
      { address: '::1', family: 6 },
    ]);
    const resolver = new DnsHostResolver();
    await expect(resolver.resolve('localhost')).resolves.toEqual(['127.0.0.1', '::1']);
    expect(mockLookup).toHaveBeenCalledWith('localhost', { all: true });
  });

  it('propagates resolution failures to the caller', async () => {
    mockLookup.mockRejectedValue(new Error('ENOTFOUND'));
    const resolver = new DnsHostResolver();
    await expect(resolver.resolve('no-such-host.invalid')).rejects.toThrow('ENOTFOUND');
  });
});
