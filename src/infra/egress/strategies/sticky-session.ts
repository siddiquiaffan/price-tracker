import { type EgressProvider } from '../egress-provider.interface.js';
import { type SelectionStrategy, type StrategyContext } from './selection-strategy.js';

/** Returns the same provider for the same session key (sticky sessions). */
export class StickySessionStrategy implements SelectionStrategy {
  readonly name = 'sticky-session';

  pick(candidates: readonly EgressProvider[], ctx: StrategyContext): EgressProvider | null {
    if (candidates.length === 0) return null;
    const key = ctx.sessionKey ?? '';
    let hash = 0;
    for (let index = 0; index < key.length; index += 1) {
      hash = (hash * 31 + key.charCodeAt(index)) >>> 0;
    }
    return candidates[hash % candidates.length] ?? candidates[0] ?? null;
  }
}
