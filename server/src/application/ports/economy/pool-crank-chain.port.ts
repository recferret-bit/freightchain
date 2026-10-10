import type { PoolChainState } from '../../../domain/economy/chain-events.js';
import type { CrankStep } from '../../../domain/economy/pool-crank.js';

/** One ticket account still on chain (not refunded yet): who gets the price, who gets the rent back. */
export interface ChainTicket {
  buyer: string;
  rentPayer: string;
  lamports: number;
}

/** One permissionless instruction for the crank to send; `tickets` only for `refund` (at most REFUND_BATCH). */
export interface CrankInstruction {
  step: CrankStep;
  poolId: number;
  tickets?: ChainTicket[];
}

/**
 * The pool crank's door to the chain (CRANK_SECRET): the crank key signs AND pays for permissionless instructions only – fail_pool, expire_pool, refund,
 * close_pool of a refunded pool – so it holds fee money and nothing else; every condition is checked again by the program. Separate from PoolChainPort,
 * whose transactions every wallet signs and pays itself. Without CRANK_SECRET `address` is null and the
 * crank does nothing (the lobby's CLAIM REFUND still works from the player's wallet).
 */
export abstract class PoolCrankChainPort {
  /** the crank key's public address; null = no CRANK_SECRET (or no program configured) – the crank is off */
  abstract get address(): string | null;
  /** the chain's Clock.unix_timestamp – the program's "now" for every deadline */
  abstract chainNow(): Promise<Date>;
  /** every pool the program ever created (Config.pool_count), terminal ones included */
  abstract listPools(): Promise<PoolChainState[]>;
  /** the Ticket accounts of a pool that still exist (a refunded ticket is a closed account) */
  abstract listTickets(poolId: number): Promise<ChainTicket[]>;
  /** build, sign with the crank key, send and wait for confirmation; ConflictError (code transaction_would_fail / transaction_failed / transaction_dropped) otherwise */
  abstract send(instruction: CrankInstruction): Promise<{ signature: string }>;
}
