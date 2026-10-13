import { type EgressProvider } from '../egress-provider.interface.js';
import { type SelectionStrategy } from './selection-strategy.js';

export class RoundRobinStrategy implements SelectionStrategy {
  readonly name = 'round-robin';
  private cursor = 0;

  pick(candidates: readonly EgressProvider[]): EgressProvider | null {
    if (candidates.length === 0) return null;
    const provider = candidates[this.cursor % candidates.length] ?? candidates[0] ?? null;
    this.cursor = (this.cursor + 1) % candidates.length;
    return provider;
  }
}
