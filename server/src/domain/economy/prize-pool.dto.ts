import type { RideTicket } from '../players/ride-ticket.entity.js';
import type { TicketGrantProps, TicketSource } from '../players/ride-ticket.types.js';
import type { Pool } from './pool.entity.js';
import type { PoolStatus } from './pool.types.js';

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
  prepDeadline: number;
  playDeadline: number;
  /** the escrow now: what the vault holds above its rent minimum */
  vaultLamports: number;
  sponsoredLamports: number;
  /** what the split is computed on: every ticket sold + sponsorship */
  potLamports: number;
  split: { prizeBps: number; seedBps: number; feeBps: number };
  treasuries: { fee: string; seed: string };
  roundId: number | null;
}

export const toPrizePoolDto = (pool: Pool): PrizePoolDto => {
  const s = pool.snapshot();
  return {
    id: s.id, address: s.address, tier: s.tier, label: s.label, status: s.status, priceLamports: s.priceLamports, minTickets: s.minTickets, maxTickets: s.maxTickets,
    maxPerWallet: s.maxPerWallet, sold: s.ticketsSold, buyers: s.buyers, toGo: pool.ticketsToGo, progressPct: pool.progress.pct,
    prepDeadline: s.prepDeadline.getTime(), playDeadline: s.playDeadline.getTime(), vaultLamports: s.vaultLamports, sponsoredLamports: s.sponsored, potLamports: pool.pot,
    split: { prizeBps: s.prizeBps, seedBps: s.seedBps, feeBps: s.feeBps }, treasuries: { fee: s.feeTreasury, seed: s.seedTreasury }, roundId: s.roundId,
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
}

/** `refundable` = money is owed back: the pool failed, or it missed its goal and nobody has failed it yet (the refund transaction then fails it first). */
export const toTicketBalanceDto = (ticket: RideTicket, pool: Pool, now: Date): TicketBalanceDto => {
  const s = pool.snapshot();
  return { poolId: s.id, tier: s.tier, label: s.label, status: s.status, balance: ticket.balance, bought: ticket.bought, cap: s.maxPerWallet, refundable: (s.status === 'refunding' || pool.isPastDeadlineUnderMinimum(now)) && ticket.bought > 0 };
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
