import type { PoolChainState, SeriesChainState } from './chain-events.js';

/** The program's SETTLE_GRACE_SECS (programs/freightchain_pools/src/constants.rs): after payout_at + this, an Active pool no longer needs the admin or the payout key. */
export const SETTLE_GRACE_MS = 14 * 86_400_000;
/** refunds per crank transaction (8 fit one transaction under the 1232-byte limit, ~13k CU each – README "Refund and idempotency") */
export const REFUND_BATCH = 8;

/** program v4 (L4): a new pool's road is sealed from a slot SEAL_DELAY_SLOTS (8, ~3 s) after it opened – the crank tries this long after `createdAt` */
export const SEAL_WAIT_MS = 8_000;

/** The permissionless instructions the crank sends (anyone may, the program checks every condition again). */
export type CrankStep = 'fail_pool' | 'expire_pool' | 'refund' | 'close_pool' | 'open_next_pool' | 'seal_road' | 'refund_sponsor';

/**
 * The next thing the crank does for a pool, from the CHAIN's state and the CHAIN's clock (the program judges both – a server clock that runs ahead would
 * only waste fees on refused transactions): an open pool past its sale end under its minimum fails; an active pool 14 days past its payout time
 * with no prize paid expires (every ticket back in full); a refunding pool gets its tickets refunded, then its sponsors (program v4, M8), then it is closed.
 * A live v4 pool whose road is not sealed yet is sealed first (L4: no ride is served until then). null = nothing to do.
 * An active pool that paid prizes is the admin's to close (or anyone's after the grace – deliberately not the crank's: it would sweep the rest to the treasuries).
 */
export function nextCrankStep(pool: PoolChainState, now: Date): CrankStep | null {
  const t = now.getTime();
  if ((pool.status === 'open' || pool.status === 'active') && (pool.sealSlot ?? 0) > 0 && t >= pool.createdAt.getTime() + SEAL_WAIT_MS) return 'seal_road';
  if (pool.status === 'open') return t >= pool.prepDeadline.getTime() && pool.ticketsSold < pool.minTickets ? 'fail_pool' : null;
  if (pool.status === 'active') return t >= pool.payoutAt.getTime() + SETTLE_GRACE_MS && pool.prizesPaid === 0 ? 'expire_pool' : null;
  if (pool.status === 'refunding') {
    if (pool.refunded < pool.priceLamports * pool.ticketsSold) return 'refund';
    return (pool.sponsorRefunded ?? pool.sponsored) < pool.sponsored ? 'refund_sponsor' : 'close_pool';   // undefined = a v3 pool: sponsors were never refunded there
  }
  return null;
}

/** Is the tier's next pool due? The program opens the pool of the CURRENT slot (`nextOpenAt + k × saleSecs`), so a late crank never shifts the grid; the
    crank sends `open_next_pool` once per slot, by the CHAIN clock. A disabled series opens nothing. */
export function seriesDue(series: SeriesChainState, now: Date): boolean {
  return series.enabled && now.getTime() >= series.nextOpenAt.getTime();
}
