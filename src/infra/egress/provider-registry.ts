import { type ProviderConfig } from '../../config/egress-config.js';
import { ValidationError } from '../../core/errors/app-error.js';
import { type EgressProvider } from './egress-provider.interface.js';
import { CloudflareWorkerProvider } from './providers/cloudflare-worker.provider.js';
import { DirectProvider } from './providers/direct.provider.js';
import { HttpProxyProvider } from './providers/http-proxy.provider.js';
import { SocksProxyProvider } from './providers/socks-proxy.provider.js';
import { UnlockerApiProvider } from './providers/unlocker-api.provider.js';

export interface ProviderFactoryDeps {
  timeoutMs: number;
}

export type ProviderFactory<T extends ProviderConfig['type']> = (
  config: Extract<ProviderConfig, { type: T }>,
  deps: ProviderFactoryDeps,
) => EgressProvider;

/**
 * Maps a provider `type` to a factory. Adding a new provider *type* = one file +
 * one `register(...)` call here.
 */
export class ProviderRegistry {
  private readonly factories = new Map<
    string,
    (config: ProviderConfig, deps: ProviderFactoryDeps) => EgressProvider
  >();

  register<T extends ProviderConfig['type']>(type: T, factory: ProviderFactory<T>): void {
    if (this.factories.has(type)) {
      throw new ValidationError(`Duplicate egress provider type registered: ${type}`);
    }
    this.factories.set(type, (config, deps) =>
      factory(config as Extract<ProviderConfig, { type: T }>, deps),
    );
  }

  create(config: ProviderConfig, deps: ProviderFactoryDeps): EgressProvider {
    const factory = this.factories.get(config.type);
    if (!factory) {
      throw new ValidationError(`Unknown egress provider type: ${config.type}`);
    }
    return factory(config, deps);
  }

  types(): string[] {
    return [...this.factories.keys()];
  }
}

export function createProviderRegistry(): ProviderRegistry {
  const registry = new ProviderRegistry();

  registry.register('direct', (config, deps) => {
    const options = {
      id: config.id,
      weight: config.weight,
      capabilities: config.capabilities,
      timeoutMs: deps.timeoutMs,
    };
    return new DirectProvider(options);
  });

  registry.register('http-proxy', (config, deps) => {
    return new HttpProxyProvider({
      id: config.id,
      url: config.url,
      weight: config.weight,
      capabilities: config.capabilities,
      timeoutMs: deps.timeoutMs,
    });
  });

  registry.register('socks', (config, deps) => {
    return new SocksProxyProvider({
      id: config.id,
      url: config.url,
      weight: config.weight,
      capabilities: config.capabilities,
      timeoutMs: deps.timeoutMs,
    });
  });

  registry.register('cloudflare-worker', (config, deps) => {
    const options: ConstructorParameters<typeof CloudflareWorkerProvider>[0] = {
      id: config.id,
      url: config.url,
      weight: config.weight,
      capabilities: config.capabilities,
      timeoutMs: deps.timeoutMs,
    };
    if (config.secret !== undefined) options.secret = config.secret;
    return new CloudflareWorkerProvider(options);
  });

  registry.register('unlocker-api', (config, deps) => {
    const options: ConstructorParameters<typeof UnlockerApiProvider>[0] = {
      id: config.id,
      url: config.url,
      weight: config.weight,
      capabilities: config.capabilities,
      timeoutMs: deps.timeoutMs,
      method: config.method,
      urlParam: config.urlParam,
    };
    if (config.authHeader !== undefined) options.authHeader = config.authHeader;
    if (config.authValue !== undefined) options.authValue = config.authValue;
    if (config.extraParams !== undefined) options.extraParams = config.extraParams;
    return new UnlockerApiProvider(options);
  });

  return registry;
}
