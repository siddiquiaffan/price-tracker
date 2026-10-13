import { z } from 'zod';

/**
 * Egress configuration schema.
 *
 * Providers are a discriminated union on `type`. Adding a *type* requires code
 * (a provider + registry entry); adding or removing an *instance* is config-only.
 */

const capabilitiesSchema = z
  .object({
    jsRendering: z.boolean().optional(),
    geo: z.array(z.string().min(2).max(2)).optional(),
    stickySessions: z.boolean().optional(),
  })
  .default({});

const baseProvider = {
  id: z.string().min(1),
  weight: z.number().positive().default(1),
  geo: z.array(z.string()).optional(),
  capabilities: capabilitiesSchema,
};

const directProviderSchema = z.object({
  ...baseProvider,
  type: z.literal('direct'),
});

const httpProxyProviderSchema = z.object({
  ...baseProvider,
  type: z.literal('http-proxy'),
  url: z.string().url(),
});

const socksProxyProviderSchema = z.object({
  ...baseProvider,
  type: z.literal('socks'),
  url: z.string().min(1),
});

const cloudflareWorkerProviderSchema = z.object({
  ...baseProvider,
  type: z.literal('cloudflare-worker'),
  url: z.string().url(),
  secret: z.string().optional(),
});

const unlockerApiProviderSchema = z.object({
  ...baseProvider,
  type: z.literal('unlocker-api'),
  url: z.string().url(),
  method: z.enum(['GET', 'POST']).default('GET'),
  authHeader: z.string().optional(),
  authValue: z.string().optional(),
  urlParam: z.string().default('url'),
  extraParams: z.record(z.string(), z.string()).optional(),
});

export const providerConfigSchema = z.discriminatedUnion('type', [
  directProviderSchema,
  httpProxyProviderSchema,
  socksProxyProviderSchema,
  cloudflareWorkerProviderSchema,
  unlockerApiProviderSchema,
]);

export const poolConfigSchema = z.object({
  strategy: z
    .enum(['round-robin', 'random', 'weighted', 'least-used', 'sticky-session'])
    .default('round-robin'),
  providers: z.array(providerConfigSchema).min(1, 'A pool needs at least one provider'),
  cooldown: z
    .object({
      baseMs: z.number().int().positive().default(30_000),
      maxMs: z.number().int().positive().default(600_000),
    })
    .default({ baseMs: 30_000, maxMs: 600_000 }),
  maxAttempts: z.number().int().positive().default(3),
});

export const egressConfigSchema = z.object({
  defaultPool: z.string().min(1).default('default'),
  pools: z.record(z.string(), poolConfigSchema),
  storePolicy: z.record(z.string(), z.string()).default({}),
});

export type ProviderConfig = z.infer<typeof providerConfigSchema>;
export type PoolConfig = z.infer<typeof poolConfigSchema>;
export type EgressConfig = z.infer<typeof egressConfigSchema>;
export type SelectionStrategyName = PoolConfig['strategy'];

const ENV_PLACEHOLDER = /\$\{([A-Z0-9_]+)\}/g;

/**
 * Recursively interpolate `${ENV_VAR}` placeholders in string values.
 * Throws if a referenced variable is not set, so misconfiguration fails fast.
 */
export function interpolateEnv(value: unknown, env: NodeJS.ProcessEnv): unknown {
  if (typeof value === 'string') {
    return value.replace(ENV_PLACEHOLDER, (_match, name: string) => {
      const resolved = env[name];
      if (resolved === undefined) {
        throw new Error(`Unresolved environment variable "\${${name}}" in egress config`);
      }
      return resolved;
    });
  }
  if (Array.isArray(value)) {
    return value.map((item) => interpolateEnv(item, env));
  }
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      out[key] = interpolateEnv(item, env);
    }
    return out;
  }
  return value;
}

function parseJson(source: string, label: string): unknown {
  try {
    return JSON.parse(source);
  } catch (error) {
    throw new Error(`Egress config (${label}) is not valid JSON: ${(error as Error).message}`);
  }
}

/**
 * Build an egress config from the legacy `PROXY` and `WORKER_URL` env vars, so
 * existing deployments keep working unchanged.
 */
export function legacyEgressConfig(env: NodeJS.ProcessEnv): EgressConfig | undefined {
  const proxy = env.PROXY?.trim();
  const worker = env.WORKER_URL?.trim();
  if (!proxy && !worker) return undefined;

  const providers: ProviderConfig[] = [];
  if (proxy) {
    const type = proxy.startsWith('socks') ? 'socks' : 'http-proxy';
    providers.push({
      id: 'legacy-proxy',
      type,
      url: proxy,
      weight: 1,
      capabilities: {},
    });
  }
  if (worker) {
    providers.push({
      id: 'legacy-worker',
      type: 'cloudflare-worker',
      url: worker,
      weight: 1,
      capabilities: {},
    });
  }

  return {
    defaultPool: 'default',
    pools: {
      default: {
        strategy: 'round-robin',
        providers,
        cooldown: { baseMs: 30_000, maxMs: 600_000 },
        maxAttempts: 3,
      },
    },
    storePolicy: {},
  };
}

export interface LoadEgressOptions {
  /** Inline JSON, a path to a JSON file, or undefined. */
  egressConfig?: string | undefined;
  env?: NodeJS.ProcessEnv;
  readFile?: (path: string) => string;
}

/**
 * Resolve the egress config from (in order): `EGRESS_CONFIG` (inline JSON or a
 * file path) or the legacy `PROXY`/`WORKER_URL` shim. `direct` is used only in
 * tests/dev when nothing is configured.
 */
export function loadEgressConfig(options: LoadEgressOptions = {}): EgressConfig {
  const env = options.env ?? process.env;
  const readFile = options.readFile ?? (() => '');
  const source = options.egressConfig?.trim();

  if (source) {
    const looksLikePath = !source.startsWith('{') && !source.startsWith('[');
    const raw = looksLikePath ? readFile(source) : source;
    const json = parseJson(raw, looksLikePath ? source : 'inline');
    const interpolated = interpolateEnv(json, env);
    return egressConfigSchema.parse(interpolated);
  }

  const legacy = legacyEgressConfig(env);
  if (legacy) return legacy;

  return {
    defaultPool: 'default',
    pools: {
      default: {
        strategy: 'round-robin',
        providers: [{ id: 'direct', type: 'direct', weight: 1, capabilities: {} }],
        cooldown: { baseMs: 30_000, maxMs: 600_000 },
        maxAttempts: 1,
      },
    },
    storePolicy: {},
  };
}
