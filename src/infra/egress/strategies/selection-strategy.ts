import { type EgressProvider } from '../egress-provider.interface.js';

export interface StrategyContext {
  /** Number of requests each provider has served so far. */
  usage: ReadonlyMap<string, number>;
  sessionKey?: string;
}

/** Chooses one provider from the eligible candidates. */
export interface SelectionStrategy {
  readonly name: string;
  pick(candidates: readonly EgressProvider[], ctx: StrategyContext): EgressProvider | null;
}
