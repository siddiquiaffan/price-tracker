import { type EgressProvider } from '../egress-provider.interface.js';
import { type SelectionStrategy, type StrategyContext } from './selection-strategy.js';

export class LeastUsedStrategy implements SelectionStrategy {
  readonly name = 'least-used';

  pick(candidates: readonly EgressProvider[], ctx: StrategyContext): EgressProvider | null {
    let best: EgressProvider | null = null;
    let bestUsage = Number.POSITIVE_INFINITY;
    for (const provider of candidates) {
      const usage = ctx.usage.get(provider.id) ?? 0;
      if (usage < bestUsage) {
        best = provider;
        bestUsage = usage;
      }
    }
    return best;
  }
}
