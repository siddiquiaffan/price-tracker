import { AppError, ValidationError } from '../../core/errors/app-error.js';
import { type BlockDetector } from '../../core/ports/block-detector.js';
import { type Clock } from '../../core/ports/clock.js';
import { type Logger } from '../../core/ports/logger.js';
import { type EgressConfig } from '../../config/egress-config.js';
import { EgressPool } from './egress-pool.js';
import {
  createProviderRegistry,
  type ProviderFactoryDeps,
  type ProviderRegistry,
} from './provider-registry.js';
import { createStrategy, type RandomFn } from './strategies/index.js';

export interface EgressPoolRegistryOptions {
  pools: Map<string, EgressPool>;
  storePolicy: Record<string, string>;
  defaultPool: string;
}

/** Resolves which {@link EgressPool} a store (or default) should use. */
export class EgressPoolRegistry {
  private readonly pools: Map<string, EgressPool>;
  private readonly storePolicy: Record<string, string>;
  private readonly defaultPool: string;

  constructor(options: EgressPoolRegistryOptions) {
    this.pools = options.pools;
    this.storePolicy = options.storePolicy;
    this.defaultPool = options.defaultPool;
  }

  pool(name: string): EgressPool {
    const pool = this.pools.get(name);
    if (!pool) throw new AppError(`Unknown egress pool: ${name}`);
    return pool;
  }

  forStore(storeId?: string): EgressPool {
    const name =
      (storeId !== undefined ? this.storePolicy[storeId] : undefined) ?? this.defaultPool;
    return this.pool(name);
  }

  names(): string[] {
    return [...this.pools.keys()];
  }

  async close(): Promise<void> {
    await Promise.all([...this.pools.values()].map(async (pool) => pool.close()));
  }
}

export interface CreatePoolRegistryOptions {
  config: EgressConfig;
  clock: Clock;
  logger: Logger;
  blockDetector: BlockDetector;
  requestTimeoutMs: number;
  providerRegistry?: ProviderRegistry;
  rng?: RandomFn;
  failureThreshold?: number;
}

/** Builds every configured pool and wires providers + strategies. */
export function createPoolRegistry(options: CreatePoolRegistryOptions): EgressPoolRegistry {
  const providerRegistry = options.providerRegistry ?? createProviderRegistry();
  const factoryDeps: ProviderFactoryDeps = { timeoutMs: options.requestTimeoutMs };
  const pools = new Map<string, EgressPool>();

  const entries = Object.entries(options.config.pools);
  for (const [name, poolConfig] of entries) {
    const providers = poolConfig.providers.map((providerConfig) =>
      providerRegistry.create(providerConfig, factoryDeps),
    );
    const poolOptions: ConstructorParameters<typeof EgressPool>[0] = {
      name,
      providers,
      strategy: createStrategy(poolConfig.strategy, options.rng ? { rng: options.rng } : {}),
      blockDetector: options.blockDetector,
      cooldown: poolConfig.cooldown,
      maxAttempts: poolConfig.maxAttempts,
      clock: options.clock,
      logger: options.logger,
    };
    if (options.failureThreshold !== undefined)
      poolOptions.failureThreshold = options.failureThreshold;
    pools.set(name, new EgressPool(poolOptions));
  }

  if (!pools.has(options.config.defaultPool)) {
    throw new ValidationError(
      `defaultPool "${options.config.defaultPool}" is not defined in pools`,
    );
  }

  return new EgressPoolRegistry({
    pools,
    storePolicy: options.config.storePolicy,
    defaultPool: options.config.defaultPool,
  });
}
