import { type EgressProvider } from '../egress-provider.interface.js';
import { type SelectionStrategy } from './selection-strategy.js';

export type RandomFn = () => number;

export class RandomStrategy implements SelectionStrategy {
  readonly name = 'random';
  constructor(private readonly rng: RandomFn = Math.random) {}

  pick(candidates: readonly EgressProvider[]): EgressProvider | null {
    if (candidates.length === 0) return null;
    const index = Math.min(Math.floor(this.rng() * candidates.length), candidates.length - 1);
    return candidates[index] ?? candidates[0] ?? null;
  }
}
