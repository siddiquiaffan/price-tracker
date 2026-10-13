import { describe, expect, it } from 'vitest';
import { loadConfig, parseAdmins, ConfigError } from '../src/config/env.js';
import {
  interpolateEnv,
  loadEgressConfig,
  legacyEgressConfig,
} from '../src/config/egress-config.js';

function baseEnv(): NodeJS.ProcessEnv {
  return {
    NODE_ENV: 'test',
    BOT_TOKEN: '123:test-token',
    API_KEY: 'secret-key',
    DB_URL: 'mongodb://localhost:27017',
  };
}

describe('loadConfig', () => {
  it('applies sensible defaults', () => {
    const config = loadConfig({ env: baseEnv() });
    expect(config.nodeEnv).toBe('test');
    expect(config.db.name).toBe('AS_TRACKER');
    expect(config.limit).toBe(5);
    expect(config.bot.polling).toBe(true);
    expect(config.stores.amazonAffiliateTag).toBe('asloot-21');
    expect(config.notifications.strategy).toBe('every-change');
    expect(config.schedule.intervalMs).toBe(3_600_000);
    expect(config.egress.pools.default?.providers[0]?.type).toBe('direct');
  });

  it('reports all missing required variables at once', () => {
    let error: ConfigError | undefined;
    try {
      loadConfig({ env: {} });
    } catch (caught) {
      error = caught as ConfigError;
    }
    expect(error).toBeInstanceOf(ConfigError);
    expect(error?.issues.join(' | ')).toContain('BOT_TOKEN');
    expect(error?.issues.join(' | ')).toContain('API_KEY');
    expect(error?.issues.join(' | ')).toContain('DB_URL');
  });

  it('parses the admin list and de-duplicates', () => {
    expect(parseAdmins('123, 456 123,999')).toEqual([123, 456, 999]);
    expect(parseAdmins('not-a-number')).toEqual([]);
    expect(parseAdmins('')).toEqual([]);
  });

  it('flips polling off in production', () => {
    const config = loadConfig({ env: { ...baseEnv(), NODE_ENV: 'production' } });
    expect(config.isProduction).toBe(true);
    expect(config.bot.polling).toBe(false);
  });

  it('reads the webhook secret when provided', () => {
    const config = loadConfig({ env: { ...baseEnv(), TELEGRAM_SECRET_TOKEN: 'webhook-secret' } });
    expect(config.bot.secretToken).toBe('webhook-secret');
  });
});

describe('legacy egress shim', () => {
  it('returns undefined when nothing is configured', () => {
    expect(legacyEgressConfig({})).toBeUndefined();
  });

  it('maps PROXY to an http-proxy provider', () => {
    const config = legacyEgressConfig({ PROXY: 'http://proxy.example:8080' });
    expect(config?.pools.default?.providers[0]).toMatchObject({
      id: 'legacy-proxy',
      type: 'http-proxy',
    });
  });

  it('maps a socks PROXY to a socks provider', () => {
    const config = legacyEgressConfig({ PROXY: 'socks5://proxy.example:1080' });
    expect(config?.pools.default?.providers[0]?.type).toBe('socks');
  });

  it('maps WORKER_URL to a cloudflare-worker provider', () => {
    const config = legacyEgressConfig({ WORKER_URL: 'https://my-worker.example.workers.dev' });
    expect(config?.pools.default?.providers[0]).toMatchObject({
      id: 'legacy-worker',
      type: 'cloudflare-worker',
    });
  });
});

describe('interpolateEnv', () => {
  it('replaces ${ENV_VAR} placeholders from the environment', () => {
    const result = interpolateEnv('https://${WORKER_HOST}/fetch', { WORKER_HOST: 'proxy.example' });
    expect(result).toBe('https://proxy.example/fetch');
  });

  it('throws when a referenced variable is missing', () => {
    expect(() => interpolateEnv('https://${MISSING_VAR}/fetch', {})).toThrow(/MISSING_VAR/);
  });
});

describe('loadEgressConfig', () => {
  it('parses inline JSON and applies defaults', () => {
    const config = loadEgressConfig({
      egressConfig: JSON.stringify({
        pools: {
          default: {
            providers: [{ id: 'main', type: 'direct', geo: ['in'] }],
          },
        },
      }),
      env: {},
    });
    expect(config.pools.default?.strategy).toBe('round-robin');
    expect(config.pools.default?.providers[0]?.id).toBe('main');
    expect(config.pools.default?.cooldown.baseMs).toBe(30_000);
  });

  it('reads from a file path and interpolates env vars', () => {
    const file = JSON.stringify({
      pools: {
        default: {
          providers: [{ id: 'proxy', type: 'http-proxy', url: 'http://${PROXY_HOST}:8080' }],
        },
      },
    });
    const config = loadEgressConfig({
      egressConfig: '/etc/egress.json',
      env: { PROXY_HOST: 'egress.internal' },
      readFile: (path) => {
        expect(path).toBe('/etc/egress.json');
        return file;
      },
    });
    expect(config.pools.default?.providers[0]?.type).toBe('http-proxy');
    const provider = config.pools.default?.providers[0];
    if (provider?.type !== 'http-proxy') throw new Error('expected an http-proxy provider');
    expect(provider.url).toBe('http://egress.internal:8080');
  });

  it('rejects a provider pool with no providers', () => {
    expect(() =>
      loadEgressConfig({
        egressConfig: JSON.stringify({ pools: { default: { providers: [] } } }),
        env: {},
      }),
    ).toThrow();
  });
});
