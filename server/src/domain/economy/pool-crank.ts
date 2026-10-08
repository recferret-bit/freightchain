import type { PoolChainState } from './chain-events.js';

/** The program's SETTLE_GRACE_SECS (programs/freightchain-pools constants.rs): after play_deadline + this, an Active pool no longer needs the admin. */
export const SETTLE_GRACE_MS = 14 * 86_400_000;
/** refunds per crank transaction (8 fit one transaction under the 1232-byte limit, ~13k CU each – README "Refund and idempotency") */
export const REFUND_BATCH = 8;

/** The permissionless instructions the crank sends (anyone may, the program checks every condition again). */
export type CrankStep = 'fail_pool' | 'expire_pool' | 'refund' | 'close_pool';

/**
 * The next thing the crank does for a pool, from the CHAIN's state and the CHAIN's clock (the program judges both – a server clock that runs ahead would
 * only waste fees on refused transactions): an open pool past its prep deadline under its minimum fails; an active pool 14 days past its play deadline
 * with no prize paid expires (every ticket back in full); a refunding pool gets its tickets refunded, then closed once all of them are. null = nothing to do.
 * An active pool that paid prizes is the admin's to close (or anyone's after the grace – deliberately not the crank's: it would sweep the rest to the treasuries).
 */
export function nextCrankStep(pool: PoolChainState, now: Date): CrankStep | null {
  const t = now.getTime();
  if (pool.status === 'open') return t >= pool.prepDeadline.getTime() && pool.ticketsSold < pool.minTickets ? 'fail_pool' : null;
  if (pool.status === 'active') return t >= pool.playDeadline.getTime() + SETTLE_GRACE_MS && pool.prizesPaid === 0 ? 'expire_pool' : null;
  if (pool.status === 'refunding') return pool.refunded < pool.priceLamports * pool.ticketsSold ? 'refund' : 'close_pool';
  return null;
}
