import { z } from 'zod';
import { type EgressConfig, loadEgressConfig } from './egress-config.js';

export const LOG_LEVELS = ['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'] as const;
export type LogLevel = (typeof LOG_LEVELS)[number];

export const NOTIFICATION_STRATEGIES = ['every-change', 'only-drop', 'threshold'] as const;
export type NotificationStrategy = (typeof NOTIFICATION_STRATEGIES)[number];

export class ConfigError extends Error {
  override readonly name = 'ConfigError';
  constructor(public readonly issues: string[]) {
    super(`Invalid configuration:\n  - ${issues.join('\n  - ')}`);
  }
}

/** Parse a space/comma separated admin list, dropping non-numeric ids. */
export function parseAdmins(raw: string): number[] {
  const ids = raw
    .split(/[\s,]+/)
    .map((part) => part.trim())
    .filter((part) => part.length > 0)
    .map((part) => Number(part))
    .filter((id) => Number.isInteger(id) && id > 0);
  return [...new Set(ids)];
}

const rawEnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  LOG_LEVEL: z.enum(LOG_LEVELS).default('info'),
  BOT_TOKEN: z.string().min(1, 'BOT_TOKEN is required'),
  API_KEY: z.string().min(1, 'API_KEY is required'),
  DB_URL: z.string().min(1, 'DB_URL is required'),
  DB_NAME: z.string().min(1).default('AS_TRACKER'),
  LIMIT: z.coerce.number().int().positive().default(5),
  ADMINS: z.string().default(''),
  TELEGRAM_SECRET_TOKEN: z.string().optional(),
  WEBHOOK_URL: z.string().url().optional(),
  AMAZON_AFFILIATE_TAG: z.string().default('asloot-21'),
  NOTIFY_STRATEGY: z.enum(NOTIFICATION_STRATEGIES).default('every-change'),
  NOTIFY_THRESHOLD_PERCENT: z.coerce.number().min(0).default(0),
  SCHEDULE_INTERVAL_MS: z.coerce.number().int().positive().default(3_600_000),
  SCHEDULE_JITTER_RATIO: z.coerce.number().min(0).max(1).default(0.1),
  REQUEST_TIMEOUT_MS: z.coerce.number().int().positive().default(15_000),
  REDIS_URL: z.string().optional(),
  EGRESS_CONFIG: z.string().optional(),
  PROXY: z.string().optional(),
  WORKER_URL: z.string().optional(),
});

export interface AppConfig {
  nodeEnv: 'development' | 'test' | 'production';
  isProduction: boolean;
  port: number;
  logLevel: LogLevel;
  limit: number;
  api: { key: string };
  bot: {
    token: string;
    admins: number[];
    polling: boolean;
    secretToken: string | undefined;
    webhookUrl: string | undefined;
  };
  db: { url: string; name: string };
  stores: { amazonAffiliateTag: string };
  notifications: { strategy: NotificationStrategy; thresholdPercent: number };
  schedule: { intervalMs: number; jitterRatio: number };
  requestTimeoutMs: number;
  redisUrl: string | undefined;
  egress: EgressConfig;
}

export interface LoadConfigOptions {
  env?: NodeJS.ProcessEnv;
  readFile?: (path: string) => string;
}

/**
 * Validate and build the typed application config. Fails fast with *all*
 * problems listed at once. This is the only module allowed to read `process.env`.
 */
export function loadConfig(options: LoadConfigOptions = {}): AppConfig {
  const env = options.env ?? process.env;
  const parsed = rawEnvSchema.safeParse(env);

  if (!parsed.success) {
    const issues = parsed.error.issues.map((issue) => {
      const key = issue.path.join('.') || '(root)';
      return `${key}: ${issue.message}`;
    });
    throw new ConfigError(issues);
  }

  const raw = parsed.data;

  let egress: EgressConfig;
  try {
    egress = loadEgressConfig({
      egressConfig: raw.EGRESS_CONFIG,
      env,
      ...(options.readFile ? { readFile: options.readFile } : {}),
    });
  } catch (error) {
    throw new ConfigError([(error as Error).message]);
  }

  return {
    nodeEnv: raw.NODE_ENV,
    isProduction: raw.NODE_ENV === 'production',
    port: raw.PORT,
    logLevel: raw.LOG_LEVEL,
    limit: raw.LIMIT,
    api: { key: raw.API_KEY },
    bot: {
      token: raw.BOT_TOKEN,
      admins: parseAdmins(raw.ADMINS),
      polling: raw.NODE_ENV !== 'production',
      secretToken: raw.TELEGRAM_SECRET_TOKEN,
      webhookUrl: raw.WEBHOOK_URL,
    },
    db: { url: raw.DB_URL, name: raw.DB_NAME },
    stores: { amazonAffiliateTag: raw.AMAZON_AFFILIATE_TAG },
    notifications: {
      strategy: raw.NOTIFY_STRATEGY,
      thresholdPercent: raw.NOTIFY_THRESHOLD_PERCENT,
    },
    schedule: {
      intervalMs: raw.SCHEDULE_INTERVAL_MS,
      jitterRatio: raw.SCHEDULE_JITTER_RATIO,
    },
    requestTimeoutMs: raw.REQUEST_TIMEOUT_MS,
    redisUrl: raw.REDIS_URL,
    egress,
  };
}
