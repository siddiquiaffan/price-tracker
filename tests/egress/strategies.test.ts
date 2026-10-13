import { describe, expect, it } from 'vitest';
import { type EgressProvider } from '../../src/infra/egress/egress-provider.interface.js';
import {
  LeastUsedStrategy,
  RandomStrategy,
  RoundRobinStrategy,
  StickySessionStrategy,
  WeightedStrategy,
  type SelectionStrategy,
  type StrategyContext,
} from '../../src/infra/egress/strategies/index.js';

function stub(id: string, weight = 1): EgressProvider {
  return {
    id,
    type: 'stub',
    weight,
    capabilities: {},
    request: () => {
      throw new Error('not used in strategy tests');
    },
  };
}

const emptyCtx: StrategyContext = { usage: new Map() };

describe('selection strategies', () => {
  it('round-robin cycles through candidates', () => {
    const strategy: SelectionStrategy = new RoundRobinStrategy();
    const candidates = [stub('a'), stub('b'), stub('c')];
    const picks: (string | undefined)[] = [];
    for (let index = 0; index < 4; index += 1) picks.push(strategy.pick(candidates, emptyCtx)?.id);
    expect(picks).toEqual(['a', 'b', 'c', 'a']);
  });

  it('random respects the injected rng', () => {
    const zero: SelectionStrategy = new RandomStrategy(() => 0);
    const almostOne: SelectionStrategy = new RandomStrategy(() => 0.999);
    const candidates = [stub('a'), stub('b'), stub('c')];
    expect(zero.pick(candidates, emptyCtx)?.id).toBe('a');
    expect(almostOne.pick(candidates, emptyCtx)?.id).toBe('c');
  });

  it('random returns null for an empty candidate list', () => {
    const strategy: SelectionStrategy = new RandomStrategy();
    expect(strategy.pick([], emptyCtx)).toBeNull();
  });

  it('weighted picks proportionally to weight', () => {
    const candidates = [stub('light', 1), stub('heavy', 3)];
    // rng=0.25 -> threshold = 0.25*4 = 1 -> light weight 1: 1-1=0 not <0; heavy: 0-3<0 -> heavy
    const heavy: SelectionStrategy = new WeightedStrategy(() => 0.25);
    const light: SelectionStrategy = new WeightedStrategy(() => 0.1);
    expect(heavy.pick(candidates, emptyCtx)?.id).toBe('heavy');
    expect(light.pick(candidates, emptyCtx)?.id).toBe('light');
  });

  it('least-used picks the provider with the fewest requests', () => {
    const strategy: SelectionStrategy = new LeastUsedStrategy();
    const candidates = [stub('a'), stub('b')];
    const ctx: StrategyContext = {
      usage: new Map([
        ['a', 10],
        ['b', 2],
      ]),
    };
    expect(strategy.pick(candidates, ctx)?.id).toBe('b');
    const empty: StrategyContext = {
      usage: new Map([
        ['a', 1],
        ['b', 0],
      ]),
    };
    expect(strategy.pick(candidates, empty)?.id).toBe('b');
  });

  it('sticky-session keeps the same provider for the same session key', () => {
    const strategy: SelectionStrategy = new StickySessionStrategy();
    const candidates = [stub('a'), stub('b'), stub('c')];
    const ctx: StrategyContext = { usage: new Map(), sessionKey: 'user-42' };
    const one = strategy.pick(candidates, ctx);
    const two = strategy.pick(candidates, ctx);
    expect(one).toBe(two);
    // A different key may map elsewhere; whatever it does must still return a candidate.
    const other = strategy.pick(candidates, { usage: new Map(), sessionKey: 'user-99' });
    expect(candidates.some((candidate) => candidate.id === other?.id)).toBe(true);
  });
});
