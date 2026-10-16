import { Injectable } from '@nestjs/common';
import type { Pool } from '../../domain/economy/pool.entity.js';
import type { PlannedPayout } from '../../domain/economy/pool-payout.js';
import { TOP20_SIZE } from '../../domain/economy/pool-payouts.js';
import { prizeBound, referralBound } from '../../domain/economy/vault-split.js';
import { allocatePoolShares } from '../../domain/referral/referral-split.js';
import { RideTicketRepositoryPort } from '../ports/players/ride-ticket.repository.port.js';
import { ReferralRepositoryPort } from '../ports/referral/referral.repository.port.js';
import { RideQueryPort } from '../ports/rides/ride-query.port.js';
import { ClockPort } from '../ports/shared/clock.port.js';
import { GameSettingsService } from './game-settings.service.js';

/**
 * The leaves of one winners root: rider prizes (the 65% plus any referral remainder) then one leaf per referrer.
 * Ranks are contiguous from 1 so a Merkle proof is proofs[rank - 1]. A referrer who also finished still gets a second leaf (PoolPayout.kind).
 * Tickets are fungible, so a wallet counts as sponsored when it bought at least one on-chain ticket for this pool. A promo grant adds a driver and no SOL.
 */
@Injectable()
export class ReferralPayoutService {
  constructor(
    private readonly rides: RideQueryPort,
    private readonly referrals: ReferralRepositoryPort,
    private readonly tickets: RideTicketRepositoryPort,
    private readonly settings: GameSettingsService,
    private readonly clock: ClockPort,
  ) {}

  async leaves(pool: Pool): Promise<PlannedPayout[]> {
    const ranking = await this.rides.poolRanking(pool.id, TOP20_SIZE, true);
    if (!ranking.length) return [];
    const s = pool.snapshot();
    const money = { priceLamports: s.priceLamports, ticketsSold: s.ticketsSold, sponsored: s.sponsored, prizeBps: s.prizeBps, seedBps: s.seedBps, referralBps: s.referralBps ?? 0 };
    const knobs = await this.settings.current();
    const ranked = ranking.map((r) => r.wallet);
    const inBoard = new Set(ranked);
    const referrerOf = new Map<string, string | null>();
    for (const wallet of ranked) referrerOf.set(wallet, await this.eligibleReferrer(wallet, pool.id, inBoard));
    const shares = allocatePoolShares({
      prizePot: prizeBound(money), referralPot: referralBound(money), ranked, referrerOf: (w) => referrerOf.get(w) ?? null,
      referrerPartBps: knobs.referralReferrerPartBps, rideCap: knobs.referralRideCapLamports,
    });
    const riders = shares.riders.filter((r) => r.lamports > 0).sort((a, b) => a.rank - b.rank);
    const riderRows: PlannedPayout[] = riders.map((r, i) => ({ poolId: pool.id, rank: i + 1, wallet: r.wallet, lamports: r.lamports, status: 'planned', kind: 'rider' }));
    const referrerRows: PlannedPayout[] = shares.referrers.map((r, i) => ({ poolId: pool.id, rank: riderRows.length + i + 1, wallet: r.wallet, lamports: r.lamports, status: 'planned', kind: 'referrer' }));
    return [...riderRows, ...referrerRows];
  }

  /**
   * Qualified, or still pending when this top-20 finish is the ride that qualifies them. Expired and self never.
   * bought >= 1: at least one ticket was paid on chain. A wallet that also holds a promo ticket is treated as on-chain.
   */
  private async eligibleReferrer(wallet: string, poolId: number, inBoard: ReadonlySet<string>): Promise<string | null> {
    const row = await this.referrals.referralOf(wallet);
    if (!row || row.referrer === wallet || row.status === 'expired') return null;
    if (row.status === 'pending' && (this.clock.now().getTime() > row.expiresAt.getTime() || !inBoard.has(wallet))) return null;
    if (row.status !== 'qualified' && row.status !== 'pending') return null;
    const ticket = await this.tickets.find(wallet, poolId);
    if (!ticket || ticket.bought < 1) return null;
    return row.referrer;
  }
}
