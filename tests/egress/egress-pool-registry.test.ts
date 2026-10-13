import { describe, expect, it } from 'vitest';
import { egressConfigSchema, type EgressConfig } from '../../src/config/egress-config.js';
import { AppError, ValidationError } from '../../src/core/errors/app-error.js';
import { CompositeBlockDetector } from '../../src/infra/egress/block-detector.js';
import {
  createPoolRegistry,
  type EgressPoolRegistry,
} from '../../src/infra/egress/egress-pool-registry.js';
import { ProviderRegistry } from '../../src/infra/egress/provider-registry.js';
import { type EgressResponse } from '../../src/infra/egress/egress-provider.interface.js';
import { FakeClock } from '../helpers/clock.js';
import { CapturingLogger } from '../helpers/logger.js';

function buildConfig(overrides: Partial<EgressConfig> = {}): EgressConfig {
  return egressConfigSchema.parse({
    defaultPool: 'default',
    pools: {
      default: {
        strategy: 'round-robin',
        maxAttempts: 2,
        cooldown: { baseMs: 1000, maxMs: 5000 },
        providers: [{ type: 'direct', id: 'direct-1', weight: 1, capabilities: {} }],
      },
      premium: {
        strategy: 'random',
        providers: [{ type: 'direct', id: 'direct-2', weight: 1, capabilities: {} }],
      },
    },
    storePolicy: { amazon: 'premium', flipkart: 'default' },
    ...overrides,
  });
}

function buildRegistry(config: EgressConfig): EgressPoolRegistry {
  return createPoolRegistry({
    config,
    clock: new FakeClock(),
    logger: new CapturingLogger(),
    blockDetector: new CompositeBlockDetector(),
    requestTimeoutMs: 5000,
  });
}

describe('EgressPoolRegistry', () => {
  it('builds a pool per configured pool and lists their names', async () => {
    const registry = buildRegistry(buildConfig());
    expect(registry.names()).toEqual(['default', 'premium']);
    await registry.close();
  });

  it('routes stores through the store policy and falls back to the default pool', async () => {
    const registry = buildRegistry(buildConfig());
    expect(registry.forStore('amazon').name).toBe('premium');
    expect(registry.forStore('flipkart').name).toBe('default');
    // Unknown stores (and no store) fall back to the default pool.
    expect(registry.forStore('unknown.store').name).toBe('default');
    expect(registry.forStore(undefined).name).toBe('default');
    expect(registry.pool('premium').name).toBe('premium');
    await registry.close();
  });

  it('fails loudly for unknown pools', () => {
    const registry = buildRegistry(buildConfig());
    expect(() => registry.pool('missing')).toThrow(AppError);
    expect(() => registry.pool('missing')).toThrow(/Unknown egress pool: missing/);
  });

  it('rejects configs whose default pool is not defined', () => {
    expect(() => buildRegistry(buildConfig({ defaultPool: 'nope' }))).toThrow(ValidationError);
  });

  it('propagates a request through the assembled pool', async () => {
    const registry = new ProviderRegistry();
    let calls = 0;
    registry.register('direct', (config) => {
      const id = config.id;
      return {
        id,
        type: 'direct' as const,
        weight: 1,
        capabilities: {},
        request(): Promise<EgressResponse> {
          calls += 1;
          return Promise.resolve({
            status: 200,
            headers: { 'content-type': 'text/plain' },
            body: `served by ${id}`,
            providerId: id,
            latencyMs: 0,
          });
        },
      };
    });

    const config = buildConfig();
    const registry2 = createPoolRegistry({
      config,
      clock: new FakeClock(),
      logger: new CapturingLogger(),
      blockDetector: new CompositeBlockDetector(),
      requestTimeoutMs: 5000,
      providerRegistry: registry,
    });

    const result = await registry2
      .forStore('amazon')
      .request({ url: new URL('https://example.com/no-net'), method: 'GET' });
    expect(result.body).toBe('served by direct-2');
    expect(calls).toBe(1);
    await registry2.close();
  });
});
