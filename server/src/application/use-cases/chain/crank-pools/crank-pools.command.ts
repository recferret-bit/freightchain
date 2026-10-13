import type { CrankStep } from '../../../../domain/economy/pool-crank.js';

/** One crank pass (docs/agents/escrow.md: CRANK_SECRET pays for the permissionless cranks): open each tier's next pool when its slot has come, then every pool
    on chain, the next permissionless step until none is left. */
export class CrankPoolsCommand {}

export interface CrankActionDto {
  /** for open_next_pool: the id the new pool got (-1 when it was not opened) */
  poolId: number;
  /** open_next_pool only: the series' tier byte */
  tier?: number;
  step: CrankStep;
  /** the transaction (null when it was refused or dropped – `error` says why; the next pass tries again) */
  signature: string | null;
  /** tickets refunded by this transaction (refund only) */
  tickets: number;
  /** the settle result of the signature: 'done' = the mirror applied its events */
  settled: 'done' | 'pending' | 'invalid' | null;
  error: string | null;
}

export interface CrankPassDto {
  /** false = no CRANK_SECRET (or no program): nothing was sent */
  enabled: boolean;
  /** the crank key's address (it pays the fees) */
  crank: string | null;
  /** the chain clock the pass judged the deadlines by (epoch ms) */
  chainNow: number | null;
  actions: CrankActionDto[];
}
