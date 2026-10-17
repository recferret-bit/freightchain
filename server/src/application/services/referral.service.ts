import { Injectable } from '@nestjs/common';
import { BadRequestError, ConflictError, NotFoundError } from '../../domain/shared/errors.js';
import { defaultCosmetic } from '../../domain/economy/cosmetics.js';
import type { Player } from '../../domain/players/player.entity.js';
import { levelOfTrip } from '../../domain/rides/ride-trip.js';
import { RideStatus } from '../../domain/rides/ride-status.js';
import { VerdictStatus } from '../../domain/verdict/verdict.dto.js';
import {
  DEFAULT_GIFT, DONATION_RENT_MIN, bindRefusal, donationShare, inviteCapacity, invitesAvailable, isGiftItem, isReferralCode, mintCode, qualifyDecision,
  type BindRefusal, type ReferralCodeRecord, type ReferralRecord,
} from '../../domain/referral/referral-rules.js';
import { CosmeticRepositoryPort } from '../ports/players/cosmetic.repository.port.js';
import { PlayerRepositoryPort } from '../ports/players/player.repository.port.js';
import { ReferralRepositoryPort } from '../ports/referral/referral.repository.port.js';
import { RideRepositoryPort } from '../ports/rides/ride.repository.port.js';
import { ClockPort } from '../ports/shared/clock.port.js';
import { EntropyPort } from '../ports/shared/entropy.port.js';
import { TransactionPort, type TransactionHandle } from '../ports/shared/transaction.port.js';
import { RideVerdictRepositoryPort } from '../ports/verdict/ride-verdict.repository.port.js';
import { GameSettingsService } from './game-settings.service.js';

const DAY_MS = 86_400_000;
const BIND_MESSAGE: Record<BindRefusal, string> = {
  own_code: 'that is your own code',
  already_bound: 'this wallet already has a referrer',
  expired: 'that invite expired',
  no_slots: 'that wallet has no invites left',
  ride_started: 'a ride has already started on this wallet',
  unknown_code: 'unknown referral code',
};

export interface ReferralInviteDto { wallet: string; status: string; at: string }

export interface ReferralView {
  code: string;
  capacity: number;
  used: number;
  pending: number;
  available: number;
  max: number;
  gift: string;
  referredBy: string | null;
  invites: ReferralInviteDto[];
}

/** Codes, binds and the qualify that follows a verified finish. The pot leaves are ReferralPayoutService. Donation shares are reserved on the order. */
@Injectable()
export class ReferralService {
  constructor(
    private readonly referrals: ReferralRepositoryPort,
    private readonly players: PlayerRepositoryPort,
    private readonly transactions: TransactionPort,
    private readonly settings: GameSettingsService,
    private readonly cosmetics: CosmeticRepositoryPort,
    private readonly rides: RideRepositoryPort,
    private readonly verdicts: RideVerdictRepositoryPort,
    private readonly clock: ClockPort,
    private readonly entropy: EntropyPort,
  ) {}

  async view(wallet: string): Promise<ReferralView> {
    const code = await this.ensureCode(wallet);
    const now = this.clock.now();
    await this.referrals.expireDue(wallet, now);
    return this.snapshot(wallet, code);
  }

  async gift(wallet: string, item: string): Promise<ReferralView> {
    if (!isGiftItem(item)) throw new BadRequestError('unknown gift', 'bad_gift');
    await this.ensureCode(wallet); // its own transaction: a nested one aborts on Postgres
    await this.transactions.run(async (tx) => {
      await this.lock([wallet], tx);
      await this.referrals.setGift(wallet, item, tx);
    });
    return this.view(wallet);
  }

  async bind(referee: string, raw: string): Promise<void> {
    const code = raw.trim().toUpperCase();
    if (!isReferralCode(code)) throw new BadRequestError('a referral code is 8 letters or digits', 'bad_code');
    await this.settleExpired(referee, code); // its own transaction: a 409 must not roll the tombstone back
    await this.transactions.run(async (tx) => {
      const owner = await this.referrals.codeByCode(code, tx);
      const referrer = owner?.wallet ?? null;
      await this.lock([referee, ...(referrer ? [referrer] : [])], tx);
      const now = this.clock.now();
      if (referrer && referrer !== referee) await this.referrals.expireDue(referrer, now, tx);
      const existing = await this.referrals.referralOf(referee, tx);
      let available = 0;
      if (referrer && referrer !== referee) {
        const settings = await this.settings.current(tx);
        const invites = await this.referrals.invitesOf(referrer, tx);
        const capacity = inviteCapacity(settings, await this.referrals.verifiedPaidShifts(referrer, tx));
        available = invitesAvailable(capacity, invites.filter((i) => i.status === 'qualified').length, invites.filter((i) => i.status === 'pending').length);
      }
      const refusal = bindRefusal({ known: !!owner, referee, referrer, existing, available, started: await this.referrals.hasStartedRide(referee, tx) });
      if (refusal) throw new ConflictError(BIND_MESSAGE[refusal], refusal);
      if (existing) return; // the same code again
      const settings = await this.settings.current(tx);
      const ok = await this.referrals.insertReferral({
        referee, referrer: referrer as string, status: 'pending', boundAt: now, expiresAt: new Date(now.getTime() + settings.referralInviteTtlDays * DAY_MS),
        qualifiedAt: null, rideId: null, freeGranted: false, badgeCounted: false,
      }, tx);
      if (!ok) throw new ConflictError(BIND_MESSAGE.already_bound, 'already_bound');
    });
  }

  /** Due pending rows become tombstones before bind decides. Covers the code's owner and an older referrer. */
  private async settleExpired(referee: string, code: string): Promise<void> {
    const owner = await this.referrals.codeByCode(code);
    const prior = await this.referrals.referralOf(referee);
    const wallets = new Set<string>();
    if (owner && owner.wallet !== referee) wallets.add(owner.wallet);
    if (prior?.status === 'pending') wallets.add(prior.referrer);
    if (!wallets.size) return;
    const now = this.clock.now();
    await this.transactions.run(async (tx) => {
      await this.lock([referee, ...wallets], tx);
      for (const wallet of wallets) await this.referrals.expireDue(wallet, now, tx);
    });
  }

  /**
   * After a verdict transaction has committed. Idempotent. A failure is logged by the caller so a referral bug never fails a saved verdict.
   * The referrer is locked here, not inside the verdict transaction: that transaction already holds the rider, and locking the referrer there deadlocks
   * when the referrer's address sorts first.
   */
  async onVerified(rideId: string): Promise<void> {
    const ride = await this.rides.findById(rideId);
    if (!ride || !ride.isInStatus(RideStatus.Completed)) return;
    const verdict = await this.verdicts.findByRide(rideId);
    if (verdict?.status !== VerdictStatus.Verified) return;
    const row = await this.referrals.referralOf(ride.wallet);
    if (!row || row.status === 'expired') return;
    const now = this.clock.now();
    if (row.status === 'pending' && now.getTime() > row.expiresAt.getTime()) {
      await this.transactions.run(async (tx) => {
        await this.lock([row.referrer, row.referee], tx);
        const fresh = await this.referrals.referralOf(row.referee, tx);
        if (fresh?.status === 'pending' && now.getTime() > fresh.expiresAt.getTime()) await this.referrals.saveReferral({ ...fresh, status: 'expired' }, tx);
      });
      return;
    }
    const settings = await this.settings.current();
    await this.transactions.run(async (tx) => {
      const locked = await this.lock([row.referrer, row.referee], tx);
      const fresh = await this.referrals.referralOf(row.referee, tx);
      if (!fresh || fresh.status === 'expired') return;
      if (fresh.status === 'pending' && now.getTime() > fresh.expiresAt.getTime()) { await this.referrals.saveReferral({ ...fresh, status: 'expired' }, tx); return; }
      const weekly = await this.referrals.weeklyFreeGrants(fresh.referrer, new Date(now.getTime() - settings.referralFreeRideWindowDays * DAY_MS), tx);
      const decision = qualifyDecision({
        status: fresh.status, now, expiresAt: fresh.expiresAt, boundAt: fresh.boundAt, alreadyFreeGranted: fresh.freeGranted, alreadyBadge: fresh.badgeCounted,
        paid: !ride.isFree, level: levelOfTrip(ride.trip), assist: ride.assist, windowDays: settings.referralFreeRideWindowDays, weeklyGranted: weekly,
        weeklyCap: settings.referralFreeRideWeeklyCap, freeReferrer: settings.referralFreeRidesReferrer, freeReferee: settings.referralFreeRidesReferee,
      });
      if (!decision.qualify && !decision.badge) return;
      const next: ReferralRecord = { ...fresh };
      if (decision.qualify) { next.status = 'qualified'; next.qualifiedAt = now; next.rideId = ride.id; }
      if (decision.freeRides) {
        const referrerPaid = await this.grant(locked, fresh.referrer, decision.freeRides.referrer, tx);
        const refereePaid = await this.grant(locked, fresh.referee, decision.freeRides.referee, tx);
        if (referrerPaid || refereePaid) next.freeGranted = true;
      }
      if (decision.badge) next.badgeCounted = true;
      if (decision.colour) await this.paint(fresh.referrer, now, tx);
      await this.referrals.saveReferral(next, tx);
    });
  }

  /** The referrer of `wallet` when a donation may pay them: qualified, and not the spectator. Null otherwise. */
  async donationReferrer(driver: string, spectator: string): Promise<string | null> {
    const row = await this.referrals.referralOf(driver);
    if (!row || row.status !== 'qualified' || row.referrer === spectator) return null;
    return row.referrer;
  }

  shareOf(price: number, bps: number, already: number, cap: number, spectatorIsReferrer: boolean): number {
    return donationShare({ price, bps, already, cap, rentMin: DONATION_RENT_MIN, spectatorIsReferrer });
  }

  private async snapshot(wallet: string, code: ReferralCodeRecord): Promise<ReferralView> {
    const settings = await this.settings.current();
    const invites = await this.referrals.invitesOf(wallet);
    const used = invites.filter((i) => i.status === 'qualified').length;
    const pending = invites.filter((i) => i.status === 'pending').length;
    const capacity = inviteCapacity(settings, await this.referrals.verifiedPaidShifts(wallet));
    const inbound = await this.referrals.referralOf(wallet);
    return {
      code: code.code, capacity, used, pending, available: invitesAvailable(capacity, used, pending), max: settings.referralMax, gift: code.gift,
      referredBy: inbound && inbound.status !== 'expired' ? inbound.referrer : null,
      invites: invites.map((i) => ({ wallet: i.referee, status: i.status, at: (i.qualifiedAt ?? i.boundAt).toISOString() })),
    };
  }

  /** Mint under the player lock. A unique clash aborts that attempt; the next attempt is a new transaction (a caught unique violation poisons the one it happened in). */
  private async ensureCode(wallet: string): Promise<ReferralCodeRecord> {
    const existing = await this.referrals.codeByWallet(wallet);
    if (existing) return existing;
    for (let i = 0; i < 5; i++) {
      try {
        return await this.transactions.run(async (tx) => {
          await this.lock([wallet], tx);
          const again = await this.referrals.codeByWallet(wallet, tx);
          if (again) return again;
          const row: ReferralCodeRecord = { wallet, code: mintCode(this.entropy.hex(8)), gift: DEFAULT_GIFT, createdAt: this.clock.now() };
          if (!(await this.referrals.insertCode(row, tx))) throw new ConflictError('code taken', 'code_taken');
          return row;
        });
      } catch (error) {
        if (error instanceof ConflictError && error.errorCode === 'code_taken') continue;
        throw error;
      }
    }
    throw new ConflictError('could not mint a referral code', 'code_exhausted');
  }

  /** Address order, so two transactions that lock the same pair cannot deadlock. Returns the rows it locked. */
  private async lock(wallets: string[], tx: TransactionHandle): Promise<Map<string, Player>> {
    const out = new Map<string, Player>();
    for (const w of [...new Set(wallets)].sort()) {
      const player = await this.players.findByWalletForUpdate(w, tx);
      if (!player) throw new NotFoundError('player not found');
      out.set(w, player);
    }
    return out;
  }

  /** A count below 1 is skipped: grantFreeRides refuses it. */
  private async grant(locked: Map<string, Player>, wallet: string, count: number, tx: TransactionHandle): Promise<boolean> {
    if (count < 1) return false;
    const player = locked.get(wallet);
    if (!player) return false;
    player.grantFreeRides(count);
    await this.players.save(player, tx);
    return true;
  }

  /** The referrer's gift colour. Equip it when they still wear the default red, or nothing. */
  private async paint(referrer: string, now: Date, tx: TransactionHandle): Promise<void> {
    const code = await this.referrals.codeByWallet(referrer, tx);
    const item = code && isGiftItem(code.gift) ? code.gift : DEFAULT_GIFT;
    if (!(await this.cosmetics.has(referrer, 'truck_color', item, tx))) {
      await this.cosmetics.unlock({ wallet: referrer, slot: 'truck_color', item, code: 'referral', at: now }, tx);
    }
    const worn = await this.cosmetics.listEquipped(referrer, tx);
    if (!worn.truck_color || worn.truck_color === defaultCosmetic('truck_color')) await this.cosmetics.equip(referrer, 'truck_color', item, tx);
  }
}
