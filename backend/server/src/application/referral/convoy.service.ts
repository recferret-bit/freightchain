import { CosmeticRepositoryPort } from '../ports/players/cosmetic.repository.port.js';
import { ReferralRepositoryPort } from '../ports/referral/referral.repository.port.js';
import { DEFAULT_GIFT, isGiftItem } from '../../domain/referral/referral-rules.js';
import { defaultCosmetic } from '../../domain/economy/cosmetics.js';
import { inviteDto, rewardDto, tasksComplete, legacyPending, type ConvoyAccountDto } from './convoy-account.js';
import { Injectable, Optional } from '@nestjs/common';
import type { Player } from '../../domain/players/player.entity.js';
import { RideStatus } from '../../domain/rides/ride-status.js';
import { CONVOY_PROMO_CODE, PromoCode } from '../../domain/economy/promo-code.entity.js';
import { PromoRepositoryPort } from '../ports/economy/promo.repository.port.js';
import { ConflictError, NotFoundError } from '../../domain/shared/errors.js';
import { DAY_MS, utcDay } from '../../domain/shared/time.js';
import { AirdropRepositoryPort } from '../airdrop/airdrop.repository.port.js';
import { GameSettingsService } from '../services/game-settings.service.js';
import { VerdictStatus } from '../../domain/verdict/verdict.dto.js';
import { NameServicePort } from '../ports/sns/name-service.port.js';
import { PlayerRepositoryPort } from '../ports/players/player.repository.port.js';
import { ClockPort } from '../ports/shared/clock.port.js';
import { TransactionPort, type TransactionHandle } from '../ports/shared/transaction.port.js';
import { ConvoyRepositoryPort, type ConvoyLedgerRow, type ConvoyRow } from './convoy.repository.port.js';
import {
  LEADERBOARD_LIMIT, M1_TEN4, M2_TEN4, REFERRER_RIDE_GIFT, countedRide, distinctWeeks, isMediumOrHardTrip, isoWeekKey, milestoneDecision, pendingCap, pendingExpired, pendingTtlMs, promoDecision, qualifyWindowMs,
  type ConvoyStatus, type PromoSkip,
} from './convoy-rules.js';

export interface ConvoyRideFact {
  rideId: string;
  wallet: string;
  status: string;
  verdict: string;
  trip: string | null;
  tier?: string;
  ranked?: boolean;
  promo?: boolean;
  weeklyGrant?: boolean;
  endedAt?: Date;
}

export interface ConvoyBindDto {
  referee: string;
  referrer: string;
  status: ConvoyStatus;
  expiresAt: string;
  pending: number;
  maxPending: number;
  idempotent: boolean;
}

export interface ConvoyGiftDto {
  granted: boolean;
  reason: PromoSkip | 'not_activation';
  referrerRideGift: 0;
}

export interface ConvoyProgressDto {
  status: ConvoyStatus | 'none';
  activated: boolean;
  expired: boolean;
  deletedPending: boolean;
  gift: ConvoyGiftDto;
  milestones: { m1: boolean; m2: boolean };
}

export interface ConvoyExpiryDto {
  deletedPending: number;
  expiredActive: number;
}

export interface ConvoyLeaderRow {
  rank: number;
  wallet: string | null;
  displayName: string;
  qualified: number;
  active: number;
  hidden: boolean;
}

export interface ConvoyLeaderboardDto {
  privacyColumn: 'present' | 'missing';
  rows: ConvoyLeaderRow[];
  me: ConvoyLeaderRow;
}

export interface ConvoyPrivacyDto {
  convoyHidden: boolean;
  column: 'present' | 'missing';
}

const idleGift = (): ConvoyGiftDto => ({ granted: false, reason: 'not_activation', referrerRideGift: REFERRER_RIDE_GIFT });

/**
 * Current Convoy machine. Legacy records remain immutable; new rewards never change free-ride balances.
 * Milestones create held rewards; the settlement worker credits only confirmed chain receipts.
 */
@Injectable()
export class ConvoyService {
  constructor(
    private readonly repo: ConvoyRepositoryPort,
    private readonly players: PlayerRepositoryPort,
    private readonly tx: TransactionPort,
    private readonly clock: ClockPort,
    private readonly names: NameServicePort,
    private readonly promos: PromoRepositoryPort,
    @Optional() private readonly campaign?: AirdropRepositoryPort,
    @Optional() private readonly settings?: GameSettingsService,
    @Optional() private readonly legacy?: ReferralRepositoryPort,
    @Optional() private readonly cosmetics?: CosmeticRepositoryPort,
  ) {}

  async account(wallet: string): Promise<ConvoyAccountDto> {
    const now = this.clock.now();
    const rows = (await this.repo.listByReferrer(wallet)).filter((row) => row.status !== 'pending' || !pendingExpired(row.expiresAt, now));
    const history = await this.legacy?.invitesOf(wallet) ?? [];
    for (const old of history) {
      const pending = legacyPending(old, now);
      if (pending && !await this.repo.getByReferee(old.referee)) rows.push(pending);
    }
    const prior = await this.legacy?.referralOf(wallet);
    const own = await this.repo.getByReferee(wallet) ?? legacyPending(prior, now);
    const inbound = own?.status === 'pending' && pendingExpired(own.expiresAt, now) ? null : own;
    const project = async (row: ConvoyRow) => inviteDto(row, await this.repo.ridesOf(row.referee), tasksComplete(await this.campaign?.get(row.referee)), !!await this.repo.findLedger(`convoy:promo:${row.referee}`));
    const pending = rows.filter((row) => row.status === 'pending').length;
    const capacity = pendingCap(await this.repo.recentActiveCount(wallet, new Date(now.getTime() - 30 * DAY_MS), now));
    const rewards = (await Promise.all(rows.flatMap((row) => ['m1', 'm2'].map((kind) => this.repo.findLedger(`convoy:${kind}:${row.referee}`))))).filter((row): row is ConvoyLedgerRow => !!row && row.wallet === wallet);
    return { capacity, used: rows.filter((row) => !!row.m1At).length, pending, available: Math.max(0, capacity - pending), max: 100,
      referredBy: inbound?.referrer ?? (prior?.status === 'qualified' ? prior.referrer : null), inbound: inbound ? await project(inbound) : null,
      invites: await Promise.all(rows.map(project)), rewards: rewards.map(rewardDto), hidden: (await this.repo.readHidden(wallet)).hidden,
      legacyQualified: history.filter((row) => row.badgeCounted).length, trustEligible: ((await this.players.findByWallet(wallet))?.trustScore ?? 0) >= 50 };
  }

  async bind(referee: string, referrer: string): Promise<ConvoyBindDto> {
    if (referee === referrer) throw new ConflictError('that is your own code', 'own_code');
    // Expiry must survive a subsequent capacity/ownership refusal.
    const prior = await this.repo.getByReferee(referee);
    await this.tx.run(async (tx) => {
      await this.lock([referee, referrer, ...(prior ? [prior.referrer] : [])], tx);
      await this.dropExpiredPending(referee, referrer, this.clock.now(), tx);
    });
    return this.tx.run(async (tx) => {
      await this.lock([referee, referrer], tx);
      const now = this.clock.now();
      await this.dropExpiredPending(referee, referrer, now, tx);
      const existing = await this.repo.getByReferee(referee, tx);
      if (existing && existing.status !== 'expired' && existing.referrer === referrer) return this.bindView(existing, true, tx);
      if (existing?.status === 'pending' || existing?.status === 'active' || existing?.status === 'qualified') throw new ConflictError('this wallet already has a referrer', 'already_bound');
      if (existing?.status === 'expired') throw new ConflictError('that invite expired', 'expired');
      const historical = await this.legacy?.referralOf(referee, tx);
      if (historical && historical.referrer !== referrer && (historical.status === 'qualified' || (historical.status === 'pending' && now.getTime() <= Math.min(historical.expiresAt.getTime(), historical.boundAt.getTime() + pendingTtlMs())))) throw new ConflictError('this wallet already has a referrer', 'already_bound');
      const invites = await this.repo.listByReferrer(referrer, tx);
      let pending = invites.filter((row) => row.status === 'pending').length;
      for (const old of await this.legacy?.invitesOf(referrer, tx) ?? []) if (legacyPending(old, now) && !await this.repo.getByReferee(old.referee, tx)) pending++;
      const maxPending = pendingCap(await this.activeFriends(referrer, now, tx));
      if (pending >= maxPending && !legacyPending(historical, now)) throw new ConflictError('that wallet has no invites left', 'no_slots');
      const row: ConvoyRow = legacyPending(historical, now) ?? {
        referee, referrer, status: 'pending', boundAt: now, expiresAt: new Date(now.getTime() + pendingTtlMs()),
        activatedAt: null, qualifyExpiresAt: null, m1At: null, m2At: null,
      };
      if (!(await this.repo.insert(row, tx))) throw new ConflictError('this wallet already has a referrer', 'already_bound');
      return this.bindView(row, false, tx);
    });
  }

  async onVerifiedRide(ride: ConvoyRideFact): Promise<ConvoyProgressDto> {
    const verified = ride.status === RideStatus.Completed && ride.verdict === VerdictStatus.Verified;
    return this.tx.run(async (tx) => {
      const now = this.clock.now();
      let preview = await this.repo.getByReferee(ride.wallet, tx);
      const historical = !preview ? await this.legacy?.referralOf(ride.wallet, tx) : null;
      const owner = preview?.referrer ?? historical?.referrer;
      const players = await this.lock(owner ? [ride.wallet, owner] : [ride.wallet], tx);
      if (!preview && verified && isMediumOrHardTrip(ride.trip) && historical && (historical.status === 'qualified' || (historical.status === 'pending' && now.getTime() <= Math.min(historical.expiresAt.getTime(), historical.boundAt.getTime() + pendingTtlMs())))) {
        preview = { referee: ride.wallet, referrer: historical.referrer, status: 'pending', boundAt: now, expiresAt: new Date(now.getTime() + pendingTtlMs()), activatedAt: null, qualifyExpiresAt: null, m1At: null, m2At: null };
        if (!await this.repo.insert(preview, tx)) throw new ConflictError('referrer changed concurrently; retry progress', 'convoy_changed');
      }
      if (!verified) return this.dropIfPendingExpired(ride.wallet, now, tx);
      const weeklyEnabled = (await this.settings?.current(tx))?.referralCountWeeklyGrant !== 0;
      const counted = countedRide(ride, players.get(ride.wallet)?.trustScore ?? 0, weeklyEnabled);
      await this.repo.recordRide({ rideId: ride.rideId, wallet: ride.wallet, at: ride.endedAt ?? now, trip: ride.trip, counted }, tx);
      const row = await this.repo.getByReferee(ride.wallet, tx);
      if (row?.referrer !== preview?.referrer) throw new ConflictError('referrer changed concurrently; retry progress', 'convoy_changed');
      if (!row) return { status: 'none', activated: false, expired: false, deletedPending: false, gift: idleGift(), milestones: { m1: false, m2: false } };
      if (row.status === 'pending') return this.activateOrDrop(row, now, isMediumOrHardTrip(ride.trip), tx);
      if (row.status === 'active' || row.status === 'qualified') return this.advance(row, now, tx);
      return { status: row.status, activated: false, expired: false, deletedPending: false, gift: idleGift(), milestones: { m1: false, m2: false } };
    });
  }

  /** Social tasks may finish after the counted rides; earning must not require an extra ride. */
  async refreshMilestones(wallet: string): Promise<void> {
    await this.tx.run(async (tx) => {
      const preview = await this.repo.getByReferee(wallet, tx);
      if (!preview) return;
      await this.lock([wallet, preview.referrer], tx);
      const row = await this.repo.getByReferee(wallet, tx);
      if (!row || row.referrer !== preview.referrer) throw new ConflictError('referrer changed concurrently; retry progress', 'convoy_changed');
      await this.applyMilestones(row, this.clock.now(), tx);
    });
  }

  async expireDue(): Promise<ConvoyExpiryDto> {
    const now = this.clock.now();
    return this.tx.run(async (tx) => {
      const pending = await this.repo.listPendingExpired(now, tx);
      const active = await this.repo.listActivePast(now, tx);
      await this.lock([...new Set(pending.concat(active).flatMap((row) => [row.referee, row.referrer]))], tx);
      let deletedPending = 0;
      for (const row of pending) {
        const fresh = await this.repo.getByReferee(row.referee, tx);
        if (fresh?.referrer === row.referrer && fresh.status === 'pending' && pendingExpired(fresh.expiresAt, now) && await this.repo.deleteReferee(fresh.referee, tx)) deletedPending += 1;
      }
      let expiredActive = 0;
      for (const row of active) {
        const fresh = await this.repo.getByReferee(row.referee, tx);
        if (fresh?.referrer !== row.referrer || fresh.status !== 'active' || fresh.m1At || !fresh.qualifyExpiresAt || !pendingExpired(fresh.qualifyExpiresAt, now)) continue;
        fresh.status = 'expired';
        await this.repo.save(fresh, tx);
        expiredActive += 1;
      }
      return { deletedPending, expiredActive };
    });
  }

  async leaderboard(viewer: string): Promise<ConvoyLeaderboardDto> {
    const privacyColumn = this.repo.privacyColumn();
    const ranked = (await this.repo.referrerCounts()).sort((a, b) => b.qualified - a.qualified || b.milestones - a.milestones || (a.firstMilestone?.getTime() ?? Infinity) - (b.firstMilestone?.getTime() ?? Infinity) || a.referrer.localeCompare(b.referrer));
    const visible = [];
    for (const row of ranked) if (!(await this.repo.readHidden(row.referrer)).hidden) visible.push(row);
    const top = visible.slice(0, LEADERBOARD_LIMIT);
    const mine = ranked.findIndex((row) => row.referrer === viewer);
    const wallets = [...new Set([...top.map((row) => row.referrer), viewer])];
    const sns = await this.names.reverseBatch(wallets);
    const hiddenOf = async (wallet: string): Promise<boolean> => (await this.repo.readHidden(wallet)).hidden;
    const rows: ConvoyLeaderRow[] = [];
    for (let i = 0; i < top.length; i++) {
      const row = top[i];
      if (!row) continue;
      rows.push(this.leaderRow(i + 1, row.referrer, row.qualified, row.active, false, sns.get(row.referrer) ?? null));
    }
    const self = mine >= 0 ? ranked[mine] : undefined;
    const me = this.leaderRow(visible.findIndex((row) => row.referrer === viewer) + 1, viewer, self?.qualified ?? 0, self?.active ?? 0, await hiddenOf(viewer), sns.get(viewer) ?? null);
    return { privacyColumn, rows, me };
  }

  async setPrivacy(wallet: string, hidden: boolean): Promise<ConvoyPrivacyDto> {
    return this.tx.run(async (tx) => {
      await this.lock([wallet], tx);
      const wrote = await this.repo.writeHidden(wallet, hidden, tx);
      return { convoyHidden: wrote.columnPresent ? wrote.hidden : false, column: wrote.columnPresent ? 'present' : 'missing' };
    });
  }

  private async activateOrDrop(row: ConvoyRow, now: Date, counted: boolean, tx: TransactionHandle): Promise<ConvoyProgressDto> {
    if (pendingExpired(row.expiresAt, now)) {
      await this.repo.deleteReferee(row.referee, tx);
      return { status: 'none', activated: false, expired: false, deletedPending: true, gift: idleGift(), milestones: { m1: false, m2: false } };
    }
    if (!counted) return { status: 'pending', activated: false, expired: false, deletedPending: false, gift: idleGift(), milestones: { m1: false, m2: false } };
    row.status = 'active';
    row.activatedAt = now;
    row.qualifyExpiresAt = new Date(now.getTime() + qualifyWindowMs());
    await this.repo.save(row, tx);
    const prior = (await this.repo.listByReferrer(row.referrer, tx)).some((item) => item.referee !== row.referee && item.activatedAt);
    const paintedHistorically = (await this.legacy?.invitesOf(row.referrer, tx) ?? []).some((item) => item.status === 'qualified');
    if (!prior && !paintedHistorically && this.cosmetics) {
      const code = await this.legacy?.codeByWallet(row.referrer, tx);
      const item = code && isGiftItem(code.gift) ? code.gift : DEFAULT_GIFT;
      if (!await this.cosmetics.has(row.referrer, 'truck_color', item, tx)) await this.cosmetics.unlock({ wallet: row.referrer, slot: 'truck_color', item, code: 'referral', at: now }, tx);
      const worn = await this.cosmetics.listEquipped(row.referrer, tx);
      if (!worn.truck_color || worn.truck_color === defaultCosmetic('truck_color')) await this.cosmetics.equip(row.referrer, 'truck_color', item, tx);
    }
    const gift = await this.grantPromo(row, now, tx);
    const milestones = await this.applyMilestones(row, now, tx);
    return { status: row.status, activated: true, expired: false, deletedPending: false, gift, milestones };
  }

  private async advance(row: ConvoyRow, now: Date, tx: TransactionHandle): Promise<ConvoyProgressDto> {
    const milestones = await this.applyMilestones(row, now, tx);
    return { status: row.status, activated: false, expired: row.status === 'expired', deletedPending: false, gift: idleGift(), milestones };
  }

  private async applyMilestones(row: ConvoyRow, now: Date, tx: TransactionHandle): Promise<{ m1: boolean; m2: boolean }> {
    if (!row.activatedAt || !row.qualifyExpiresAt || (row.status !== 'active' && row.status !== 'qualified')) return { m1: false, m2: false };
    const refereeRides = await this.repo.ridesOf(row.referee, tx);
    const tasks = await this.campaign?.get(row.referee, tx);
    const eligible = ((await this.players.findByWallet(row.referrer, tx))?.trustScore ?? 0) >= 50;
    const decision = milestoneDecision({
      m1At: row.m1At, m2At: row.m2At, qualifyExpiresAt: row.qualifyExpiresAt, now,
      refereeWeeks: distinctWeeks(refereeRides, row.activatedAt, row.qualifyExpiresAt),
      tasksComplete: eligible && tasksComplete(tasks),
    });
    if (decision.expire) {
      row.status = 'expired';
      await this.repo.save(row, tx);
      return { m1: false, m2: false };
    }
    const m1 = decision.m1 && await this.ledger(row, 'm1', M1_TEN4, now, tx);
    const m2 = decision.m2 && await this.ledger(row, 'm2', M2_TEN4, now, tx);
    if (m1 || m2 || (row.m1At && row.status !== 'qualified')) {
      if (row.m1At) row.status = 'qualified';
      await this.repo.save(row, tx);
    }
    return { m1, m2 };
  }

  private async ledger(row: ConvoyRow, kind: 'm1' | 'm2', amount: number, now: Date, tx: TransactionHandle): Promise<boolean> {
    const id = `convoy:${kind}:${row.referee}`;
    const inserted = await this.repo.insertLedger({ ...this.ledgerRow(id, kind, row.referrer, amount, 'ten4', row, now), releasedAt: null, chainState: 'held' }, tx);
    if (!inserted) return false;
    // Qualification is earned now; a 48h payment hold cannot push it past the 60-day eligibility window.
    if (kind === 'm1') row.m1At = now;
    else row.m2At = now;
    row.status = 'qualified';
    return true;
  }

  private async grantPromo(row: ConvoyRow, now: Date, tx: TransactionHandle): Promise<ConvoyGiftDto> {
    await this.repo.lockPromoBudget(tx);
    const rows = await this.repo.ledger(tx);
    const day = utcDay(now);
    const week = isoWeekKey(now);
    const promo = rows.filter((item) => item.kind === 'promo_1h');
    const reason = promoDecision({
      lifetime: promo.some((item) => item.referee === row.referee),
      day: promo.filter((item) => item.referrer === row.referrer && item.dayKey === day).length,
      week: promo.filter((item) => item.referrer === row.referrer && item.weekKey === week).length,
      globalWeek: promo.filter((item) => item.weekKey === week).length,
    });
    if (reason !== 'ok') return { granted: false, reason, referrerRideGift: 0 };
    const inserted = await this.repo.insertLedger(this.ledgerRow(`convoy:promo:${row.referee}`, 'promo_1h', row.referee, 1, 'ride', row, now), tx);
    if (!inserted) return { granted: false, reason: 'lifetime', referrerRideGift: 0 };
    // Disabled for public redemption; only this capped, player-locked activation issues its grant.
    const code = CONVOY_PROMO_CODE;
    const existing = await this.promos.findByCode(code, tx);
    if (existing && (existing.effect.kind !== 'ride' || existing.effect.tier !== '1h' || existing.snapshot().note !== 'internal:convoy')) throw new ConflictError('reserved Convoy grant code is occupied', 'convoy_grant_conflict');
    if (!existing) {
      await this.promos.insert(PromoCode.restore({ code, effect: { kind: 'ride', tier: '1h' }, description: 'Convoy activation', note: 'internal:convoy', perWallet: 1, maxRedemptions: null, startsAt: now, expiresAt: null, createdAt: now, redeemed: 0, disabledAt: now }), tx);
    }
    await this.promos.disable(code, now, tx);
    await this.promos.insertGrant({ code, wallet: row.referee, n: 1, tier: '1h', rideId: null, createdAt: now }, tx);
    return { granted: true, reason: 'ok', referrerRideGift: 0 };
  }

  private ledgerRow(id: string, kind: ConvoyLedgerRow['kind'], wallet: string, amount: number, unit: ConvoyLedgerRow['unit'], row: ConvoyRow, now: Date): ConvoyLedgerRow {
    return { id, kind, wallet, referrer: row.referrer, referee: row.referee, amount, unit, at: now, dayKey: utcDay(now), weekKey: isoWeekKey(now) };
  }

  private async dropExpiredPending(referee: string, referrer: string, now: Date, tx: TransactionHandle): Promise<void> {
    const own = await this.repo.getByReferee(referee, tx);
    if (own?.status === 'pending' && pendingExpired(own.expiresAt, now)) await this.repo.deleteReferee(referee, tx);
    for (const row of await this.repo.listByReferrer(referrer, tx)) {
      if (row.status === 'pending' && pendingExpired(row.expiresAt, now)) await this.repo.deleteReferee(row.referee, tx);
    }
  }

  private async dropIfPendingExpired(wallet: string, now: Date, tx: TransactionHandle): Promise<ConvoyProgressDto> {
    const row = await this.repo.getByReferee(wallet, tx);
    if (row?.status === 'pending' && pendingExpired(row.expiresAt, now)) {
      await this.repo.deleteReferee(wallet, tx);
      return { status: 'none', activated: false, expired: false, deletedPending: true, gift: idleGift(), milestones: { m1: false, m2: false } };
    }
    return { status: row?.status ?? 'none', activated: false, expired: false, deletedPending: false, gift: idleGift(), milestones: { m1: false, m2: false } };
  }

  private async bindView(row: ConvoyRow, idempotent: boolean, tx: TransactionHandle): Promise<ConvoyBindDto> {
    const invites = await this.repo.listByReferrer(row.referrer, tx);
    const pending = invites.filter((item) => item.status === 'pending').length;
    return { referee: row.referee, referrer: row.referrer, status: row.status, expiresAt: row.expiresAt.toISOString(), pending, maxPending: pendingCap(await this.activeFriends(row.referrer, this.clock.now(), tx)), idempotent };
  }

  private activeFriends(referrer: string, now: Date, tx: TransactionHandle): Promise<number> {
    return this.repo.recentActiveCount(referrer, new Date(now.getTime() - 30 * DAY_MS), now, tx);
  }

  private leaderRow(rank: number, wallet: string, qualified: number, active: number, hidden: boolean, sns: string | null): ConvoyLeaderRow {
    return { rank, wallet, displayName: sns ?? wallet, qualified, active, hidden };
  }

  private async lock(wallets: readonly string[], tx: TransactionHandle): Promise<Map<string, Player>> {
    const out = new Map<string, Player>();
    for (const wallet of [...new Set(wallets)].sort()) {
      const player = await this.players.findByWalletForUpdate(wallet, tx);
      if (!player) throw new NotFoundError('player not found', 'player_not_found');
      out.set(wallet, player);
    }
    return out;
  }
}
