import { describe, expect, it } from 'vitest';
/* eslint-disable @typescript-eslint/require-await -- provider stubs must match the async port */
import {
  type EgressProvider,
  type EgressRequest,
  type EgressResponse,
} from '../../src/infra/egress/egress-provider.interface.js';
import { EgressPool } from '../../src/infra/egress/egress-pool.js';
import { CompositeBlockDetector } from '../../src/infra/egress/block-detector.js';
import { RoundRobinStrategy } from '../../src/infra/egress/strategies/index.js';
import { AllEgressFailedError } from '../../src/core/errors/app-error.js';
import { FakeClock } from '../helpers/clock.js';
import { CapturingLogger } from '../helpers/logger.js';

let providerSerial = 0;

class ScriptedProvider implements EgressProvider {
  readonly id: string;
  readonly type = 'scripted';
  readonly weight: number;
  readonly capabilities = {};
  requests: EgressRequest[] = [];
  outcome: () => Promise<EgressResponse> = async () => defaultOk(this.id);

  constructor(id?: string) {
    this.id = id ?? `provider-${(providerSerial += 1)}`;
    this.weight = 1;
  }

  async request(req: EgressRequest): Promise<EgressResponse> {
    this.requests.push(req);
    return this.outcome();
  }
}

function defaultOk(providerId: string): EgressResponse {
  return { status: 200, headers: {}, body: '<html>ok</html>', providerId, latencyMs: 10 };
}

function blocked(providerId: string): EgressResponse {
  return { status: 403, headers: {}, body: 'captcha', providerId, latencyMs: 10 };
}

function createPool(providers: ScriptedProvider[], clock: FakeClock, maxAttempts = 3): EgressPool {
  return new EgressPool({
    name: 'test',
    providers,
    strategy: new RoundRobinStrategy(),
    blockDetector: new CompositeBlockDetector(),
    cooldown: { baseMs: 10_000, maxMs: 60_000 },
    maxAttempts,
    failureThreshold: 2,
    clock,
    logger: new CapturingLogger(),
  });
}

describe('EgressPool', () => {
  it('round-robins across healthy providers', async () => {
    const clock = new FakeClock();
    const a = new ScriptedProvider('a');
    const b = new ScriptedProvider('b');
    const c = new ScriptedProvider('c');
    const pool = createPool([a, b, c], clock);

    const first = await pool.request({ url: new URL('https://example.com/1'), method: 'GET' });
    const second = await pool.request({ url: new URL('https://example.com/2'), method: 'GET' });
    const third = await pool.request({ url: new URL('https://example.com/3'), method: 'GET' });

    expect(first.providerId).toBe('a');
    expect(second.providerId).toBe('b');
    expect(third.providerId).toBe('c');
  });

  it('fails over when a provider returns a blocked page', async () => {
    const clock = new FakeClock();
    const a = new ScriptedProvider('a');
    const b = new ScriptedProvider('b');
    a.outcome = async () => blocked('a');
    const pool = createPool([a, b], clock, 2);

    const response = await pool.request({ url: new URL('https://example.com/'), method: 'GET' });
    expect(response.providerId).toBe('b');
    expect(a.requests.length + b.requests.length).toBe(2);
  });

  it('fails over on a network error', async () => {
    const clock = new FakeClock();
    const a = new ScriptedProvider('a');
    const b = new ScriptedProvider('b');
    a.outcome = async () => {
      throw new Error('connection reset');
    };
    const pool = createPool([a, b], clock, 2);

    const response = await pool.request({ url: new URL('https://example.com/'), method: 'GET' });
    expect(response.providerId).toBe('b');
  });

  it('throws AllEgressFailedError when everyone is blocked', async () => {
    const clock = new FakeClock();
    const a = new ScriptedProvider('a');
    const b = new ScriptedProvider('b');
    a.outcome = async () => blocked('a');
    b.outcome = async () => blocked('b');
    const pool = createPool([a, b], clock, 2);

    await expect(
      pool.request({ url: new URL('https://example.com/'), method: 'GET' }),
    ).rejects.toBeInstanceOf(AllEgressFailedError);
  });

  it('cools a provider down after consecutive failures and resumes later', async () => {
    const clock = new FakeClock();
    const a = new ScriptedProvider('a');
    const b = new ScriptedProvider('b');
    a.outcome = async () => blocked('a');
    const pool = createPool([a, b], clock, 3);

    // Two failures (threshold) on `a`, served by `b`.
    await pool.request({ url: new URL('https://example.com/1'), method: 'GET' });
    await pool.request({ url: new URL('https://example.com/2'), method: 'GET' });

    const statsBefore = pool.stats().find((stat) => stat.id === 'a');
    expect(statsBefore?.coolingDown).toBe(true);

    // Advance past the cooldown window: `a` recovers and can serve again.
    clock.advance(20_000);
    a.outcome = async () => defaultOk('a');
    b.outcome = async () => blocked('b');
    const third = await pool.request({ url: new URL('https://example.com/3'), method: 'GET' });
    expect(third.providerId).toBe('a');
    const statsAfter = pool.stats().find((stat) => stat.id === 'a');
    expect(statsAfter?.coolingDown).toBe(false);
    expect(statsAfter?.consecutiveFailures).toBe(0);
  });

  it('exposes cumulative stats', async () => {
    const clock = new FakeClock();
    const a = new ScriptedProvider('a');
    const pool = createPool([a], clock, 1);
    await pool.request({ url: new URL('https://example.com/'), method: 'GET' });

    const stats = pool.stats();
    expect(stats[0]).toMatchObject({ id: 'a', requests: 1, successes: 1, failures: 0 });
  });

  it('rejects requests after close', async () => {
    const clock = new FakeClock();
    const pool = createPool([new ScriptedProvider('a')], clock, 1);
    await pool.close();
    await expect(
      pool.request({ url: new URL('https://example.com/'), method: 'GET' }),
    ).rejects.toThrow();
  });
});
