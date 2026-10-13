import { AllEgressFailedError } from '../../core/errors/app-error.js';
import { type BlockDetector } from '../../core/ports/block-detector.js';
import { type Clock } from '../../core/ports/clock.js';
import { type Logger } from '../../core/ports/logger.js';
import {
  EgressRequestError,
  type EgressProvider,
  type EgressRequest,
  type EgressRequestOptions,
  type EgressResponse,
} from './egress-provider.interface.js';
import { type SelectionStrategy } from './strategies/index.js';

export interface EgressPoolOptions {
  name: string;
  providers: readonly EgressProvider[];
  strategy: SelectionStrategy;
  blockDetector: BlockDetector;
  cooldown: { baseMs: number; maxMs: number };
  maxAttempts: number;
  /** Consecutive failures before a provider is parked in cooldown. */
  failureThreshold?: number;
  clock: Clock;
  logger: Logger;
}

interface ProviderState {
  consecutiveFailures: number;
  cooldownUntil: number;
  requests: number;
  successes: number;
  failures: number;
  latencies: number[];
}

export interface ProviderStats {
  id: string;
  type: string;
  weight: number;
  requests: number;
  successes: number;
  failures: number;
  consecutiveFailures: number;
  coolingDown: boolean;
  cooldownUntil: string | null;
  avgLatencyMs: number;
  p95LatencyMs: number;
}

function percentile(values: readonly number[], fraction: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(Math.ceil(fraction * sorted.length) - 1, sorted.length - 1);
  return sorted[Math.max(index, 0)] ?? 0;
}

/**
 * A pool of interchangeable egress providers. Picks one per request, detects
 * blocks, fails over to a different provider, and cools failing providers down
 * with exponential backoff.
 */
export class EgressPool {
  readonly name: string;
  private readonly providers: readonly EgressProvider[];
  private readonly strategy: SelectionStrategy;
  private readonly blockDetector: BlockDetector;
  private readonly cooldown: { baseMs: number; maxMs: number };
  private readonly maxAttempts: number;
  private readonly failureThreshold: number;
  private readonly clock: Clock;
  private readonly logger: Logger;
  private readonly states = new Map<string, ProviderState>();
  private closed = false;

  constructor(options: EgressPoolOptions) {
    this.name = options.name;
    this.providers = options.providers;
    this.strategy = options.strategy;
    this.blockDetector = options.blockDetector;
    this.cooldown = options.cooldown;
    this.maxAttempts = options.maxAttempts;
    this.failureThreshold = options.failureThreshold ?? 2;
    this.clock = options.clock;
    this.logger = options.logger;
    for (const provider of options.providers) {
      this.states.set(provider.id, {
        consecutiveFailures: 0,
        cooldownUntil: 0,
        requests: 0,
        successes: 0,
        failures: 0,
        latencies: [],
      });
    }
  }

  private state(id: string): ProviderState {
    let state = this.states.get(id);
    if (!state) {
      state = {
        consecutiveFailures: 0,
        cooldownUntil: 0,
        requests: 0,
        successes: 0,
        failures: 0,
        latencies: [],
      };
      this.states.set(id, state);
    }
    return state;
  }

  private now(): number {
    return this.clock.now().getTime();
  }

  private isCoolingDown(id: string, now: number): boolean {
    return this.state(id).cooldownUntil > now;
  }

  private usageMap(): Map<string, number> {
    const usage = new Map<string, number>();
    for (const [id, state] of this.states) usage.set(id, state.requests);
    return usage;
  }

  private recordSuccess(id: string, latencyMs: number): void {
    const state = this.state(id);
    state.successes += 1;
    state.consecutiveFailures = 0;
    state.cooldownUntil = 0;
    state.latencies.push(latencyMs);
    if (state.latencies.length > 100) state.latencies.shift();
  }

  private recordFailure(id: string, now: number, reason: string): void {
    const state = this.state(id);
    state.failures += 1;
    state.consecutiveFailures += 1;
    if (state.consecutiveFailures >= this.failureThreshold) {
      const exponent = state.consecutiveFailures - this.failureThreshold;
      const backoff = Math.min(this.cooldown.baseMs * 2 ** exponent, this.cooldown.maxMs);
      state.cooldownUntil = now + backoff;
      this.logger.warn(
        {
          providerId: id,
          pool: this.name,
          consecutiveFailures: state.consecutiveFailures,
          backoffMs: backoff,
          reason,
        },
        'egress provider entered cooldown',
      );
    }
  }

  /** Proactively re-check providers whose cooldown has elapsed. */
  async healthCheckAll(): Promise<void> {
    const now = this.now();
    for (const provider of this.providers) {
      const state = this.state(provider.id);
      if (state.cooldownUntil === 0 || state.cooldownUntil > now) continue;
      if (provider.healthCheck) {
        try {
          const healthy = await provider.healthCheck();
          if (healthy) {
            this.recordSuccess(provider.id, 0);
          } else {
            state.cooldownUntil = now + this.cooldown.baseMs;
          }
        } catch {
          state.cooldownUntil = now + this.cooldown.baseMs;
        }
      } else {
        this.recordSuccess(provider.id, 0);
      }
    }
  }

  private select(
    candidates: readonly EgressProvider[],
    sessionId: string | undefined,
  ): EgressProvider | null {
    const context: { usage: ReadonlyMap<string, number>; sessionKey?: string } = {
      usage: this.usageMap(),
    };
    if (sessionId !== undefined) context.sessionKey = sessionId;
    return this.strategy.pick(candidates, context);
  }

  async request(req: EgressRequest, opts?: EgressRequestOptions): Promise<EgressResponse> {
    if (this.closed) {
      throw new AllEgressFailedError(`Egress pool "${this.name}" is closed`, []);
    }
    await this.healthCheckAll();
    const now = this.now();
    const attempted = new Set<string>();
    const failures: { providerId: string; reason: string }[] = [];

    for (let attempt = 0; attempt < this.maxAttempts; attempt += 1) {
      let candidates = this.providers.filter(
        (provider) => !attempted.has(provider.id) && !this.isCoolingDown(provider.id, now),
      );
      if (candidates.length === 0) {
        // Everyone is cooling down: as a last resort, still try un-attempted ones.
        candidates = this.providers.filter((provider) => !attempted.has(provider.id));
      }
      if (candidates.length === 0) break;

      const provider = this.select(candidates, opts?.sessionId);
      if (!provider) break;
      attempted.add(provider.id);
      this.state(provider.id).requests += 1;

      try {
        const response = await provider.request(req, opts);
        const detection = {
          status: response.status,
          body: response.body,
          headers: response.headers,
        };
        if (this.blockDetector.isBlocked(detection)) {
          const reason =
            this.blockDetector.reason?.(detection) ?? `blocked (status ${response.status})`;
          this.recordFailure(provider.id, now, reason);
          failures.push({ providerId: provider.id, reason });
          continue;
        }
        this.recordSuccess(provider.id, response.latencyMs);
        return response;
      } catch (error) {
        const reason =
          error instanceof EgressRequestError
            ? error.message
            : error instanceof Error
              ? error.message
              : String(error);
        this.recordFailure(provider.id, now, reason);
        failures.push({ providerId: provider.id, reason });
      }
    }

    throw new AllEgressFailedError(
      `All egress providers failed in pool "${this.name}" for ${req.url.origin}`,
      failures,
    );
  }

  stats(): ProviderStats[] {
    const now = this.now();
    return this.providers.map((provider) => {
      const state = this.state(provider.id);
      const avg =
        state.latencies.length === 0
          ? 0
          : state.latencies.reduce((sum, value) => sum + value, 0) / state.latencies.length;
      return {
        id: provider.id,
        type: provider.type,
        weight: provider.weight,
        requests: state.requests,
        successes: state.successes,
        failures: state.failures,
        consecutiveFailures: state.consecutiveFailures,
        coolingDown: this.isCoolingDown(provider.id, now),
        cooldownUntil: state.cooldownUntil > 0 ? new Date(state.cooldownUntil).toISOString() : null,
        avgLatencyMs: Math.round(avg),
        p95LatencyMs: Math.round(percentile(state.latencies, 0.95)),
      };
    });
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    await Promise.all(
      this.providers.map(async (provider) => {
        try {
          await provider.close?.();
        } catch (error) {
          this.logger.warn({ error, providerId: provider.id }, 'failed to close egress provider');
        }
      }),
    );
  }
}
