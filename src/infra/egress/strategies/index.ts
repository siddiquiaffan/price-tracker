import { type SelectionStrategyName } from '../../../config/egress-config.js';
import { LeastUsedStrategy } from './least-used.js';
import { RandomStrategy, type RandomFn } from './random.js';
import { RoundRobinStrategy } from './round-robin.js';
import { type SelectionStrategy } from './selection-strategy.js';
import { StickySessionStrategy } from './sticky-session.js';
import { WeightedStrategy } from './weighted.js';

export * from './selection-strategy.js';
export { RoundRobinStrategy } from './round-robin.js';
export { RandomStrategy, type RandomFn } from './random.js';
export { WeightedStrategy } from './weighted.js';
export { LeastUsedStrategy } from './least-used.js';
export { StickySessionStrategy } from './sticky-session.js';

export interface CreateStrategyOptions {
  rng?: RandomFn;
}

export function createStrategy(
  name: SelectionStrategyName,
  options: CreateStrategyOptions = {},
): SelectionStrategy {
  switch (name) {
    case 'round-robin':
      return new RoundRobinStrategy();
    case 'random':
      return new RandomStrategy(options.rng);
    case 'weighted':
      return new WeightedStrategy(options.rng);
    case 'least-used':
      return new LeastUsedStrategy();
    case 'sticky-session':
      return new StickySessionStrategy();
  }
}
