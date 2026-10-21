import type { RideTicket } from '../players/ride-ticket.entity.js';
import type { TicketGrantProps, TicketSource } from '../players/ride-ticket.types.js';
import type { Pool } from './pool.entity.js';
import { derivedSchedule, schedulePhase, type PoolPhase } from './pool-schedule.js';
import type { PayoutState, PoolStatus } from './pool.types.js';

/** An escrowed prize pool as the lobby and the landing show it ("7 / 10 committed"). Lamports are integers, timestamps epoch ms. */
export interface PrizePoolDto {
  id: number;
  /** the Pool PDA – the client links it to the explorer */
  address: string;
  tier: string;
  label: string;
  status: PoolStatus;
  priceLamports: number;
  minTickets: number;
  /** 0 = unlimited */
  maxTickets: number;
  maxPerWallet: number;
  sold: number;
  buyers: number;
  /** tickets still missing before the pool goes live (0 once active) */
  toGo: number;
  /** sold / min, capped at 100 */
  progressPct: number;
  /** the sale window ends here (open or active: no ticket is sold after it) */
  prepDeadline: number;
  /** rides count until here */
  playDeadline: number;
  /** the review window ends here: winners are paid from this moment (the program refuses any prize before it) */
  payoutAt: number;
  /** the payout job: state, why, and whether an admin holds it */
  payout: { state: PayoutState; note: string | null; held: boolean };
  /** the escrow now: what the vault holds above its rent minimum */
  vaultLamports: number;
  sponsoredLamports: number;
  /** what the split is computed on: every ticket sold + sponsorship */
  potLamports: number;
  split: { prizeBps: number; seedBps: number; feeBps: number; referralBps: number };
  treasuries: { fee: string; seed: string };
  roundId: number | null;
  opensAt: number;
  salesCloseAt: number;
  lastStartAt: number;
  playCloseAt: number;
  validationUntil: number;
  /** upcoming | open | finishing | validating | paid | closed */
  phase: PoolPhase;
}

export const toPrizePoolDto = (pool: Pool, now?: Date): PrizePoolDto => {
  const s = pool.snapshot();
  const at = now ?? s.prepDeadline;
  const schedule = derivedSchedule(s);
  return {
    id: s.id, address: s.address, tier: s.tier, label: s.label, status: s.status, priceLamports: s.priceLamports, minTickets: s.minTickets, maxTickets: s.maxTickets,
    maxPerWallet: s.maxPerWallet, sold: s.ticketsSold, buyers: s.buyers, toGo: pool.ticketsToGo, progressPct: pool.progress.pct,
    prepDeadline: s.prepDeadline.getTime(), playDeadline: s.playDeadline.getTime(), payoutAt: s.payoutAt.getTime(),
    payout: { state: s.payoutState, note: s.payoutNote, held: s.hold !== null }, vaultLamports: s.vaultLamports, sponsoredLamports: s.sponsored, potLamports: pool.pot,
    split: { prizeBps: s.prizeBps, seedBps: s.seedBps, feeBps: s.feeBps, referralBps: s.referralBps ?? 0 }, treasuries: { fee: s.feeTreasury, seed: s.seedTreasury }, roundId: s.roundId,
    opensAt: schedule.opensAt.getTime(), salesCloseAt: schedule.salesCloseAt.getTime(), lastStartAt: schedule.lastStartAt.getTime(),
    playCloseAt: schedule.playCloseAt.getTime(), validationUntil: schedule.validationUntil.getTime(),
    phase: schedulePhase(s.status, s.payoutState, schedule, at),
  };
};

/** A wallet's tickets in one pool (/api/me, /api/profile). */
export interface TicketBalanceDto {
  poolId: number;
  tier: string;
  label: string;
  status: PoolStatus;
  /** unused tickets */
  balance: number;
  /** ever paid for on chain */
  bought: number;
  /** the pool's per-wallet cap */
  cap: number;
  /** the pool failed and this wallet paid into it on chain: it can claim its lamports back (cleared when its Refunded event lands – `bought` goes to 0) */
  refundable: boolean;
  /** an unused ticket here can be ridden NOW (live pool, before its play deadline) – what POST /api/rides spends */
  ridable: boolean;
  /** the last moment a shift can START with this ticket (ms): lastStartAt, or earlier when the shift could not finish by play close */
  rideBy: number;
  /** an unused ticket after lastStartAt: shown as spent, not refundable. The lamports stay in this pool. */
  burned: boolean;
}

/** `refundable` = money is owed back: the pool failed, or it missed its goal and nobody has failed it yet (the refund transaction then fails it first). */
export const toTicketBalanceDto = (ticket: RideTicket, pool: Pool, now: Date, shiftSeconds: number = pool.shiftSeconds): TicketBalanceDto => {
  const s = pool.snapshot();
  const burned = now.getTime() > pool.lastStartAt.getTime() && ticket.balance > 0 && s.status !== 'refunding' && s.status !== 'cancelled';
  return {
    poolId: s.id, tier: s.tier, label: s.label, status: s.status, balance: burned ? 0 : ticket.balance, bought: ticket.bought, cap: s.maxPerWallet,
    refundable: !burned && (s.status === 'refunding' || pool.isPastDeadlineUnderMinimum(now)) && ticket.bought > 0,
    ridable: !burned && ticket.balance > 0 && pool.isRidable(now, shiftSeconds), rideBy: pool.startBy(shiftSeconds).getTime(), burned,
  };
};

/** One line of the ticket audit trail (/api/profile). */
export interface TicketGrantDto {
  poolId: number;
  delta: number;
  source: TicketSource;
  ref: string | null;
  at: number;
}

export const toTicketGrantDto = (g: TicketGrantProps): TicketGrantDto => ({ poolId: g.poolId, delta: g.delta, source: g.source, ref: g.ref, at: g.at.getTime() });
