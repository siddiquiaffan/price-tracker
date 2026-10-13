import { type EgressProvider } from '../egress-provider.interface.js';
import { type RandomFn } from './random.js';
import { type SelectionStrategy } from './selection-strategy.js';

/** Weighted random selection; converges to configured ratios over many draws. */
export class WeightedStrategy implements SelectionStrategy {
  readonly name = 'weighted';
  constructor(private readonly rng: RandomFn = Math.random) {}

  pick(candidates: readonly EgressProvider[]): EgressProvider | null {
    if (candidates.length === 0) return null;
    const total = candidates.reduce((sum, provider) => sum + provider.weight, 0);
    if (total <= 0) return candidates[0] ?? null;
    let threshold = this.rng() * total;
    for (const provider of candidates) {
      threshold -= provider.weight;
      if (threshold < 0) return provider;
    }
    return candidates[candidates.length - 1] ?? candidates[0] ?? null;
  }
}
