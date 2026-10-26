import { MemoryAirdropRepository } from '../../../../src/infrastructure/social/memory-airdrop.repository.js';
import { emptyAirdrop } from '../../../../src/application/airdrop/airdrop-rules.js';
import { MemoryDb } from '../../../support/in-memory/memory-db.js';
import { MemoryPromoRepository } from '../../../support/in-memory/memory-ledger-repositories.js';
import { NameServicePort } from '../../../../src/application/ports/sns/name-service.port.js';
import { PlayerRepositoryPort } from '../../../../src/application/ports/players/player.repository.port.js';
import { ClockPort } from '../../../../src/application/ports/shared/clock.port.js';
import { TransactionPort, type TransactionHandle } from '../../../../src/application/ports/shared/transaction.port.js';
import { MemoryConvoyRepository } from '../../../../src/infrastructure/social/memory-convoy.repository.js';
import { ConvoyService, type ConvoyRideFact } from '../../../../src/application/referral/convoy.service.js';
import { countedRide, distinctWeeks, isMediumOrHardTrip, isoWeekKey, milestoneDecision, pendingCap, pendingTtlMs, promoDecision, qualifyWindowMs } from '../../../../src/application/referral/convoy-rules.js';
import { qualifyDecision } from '../../../../src/domain/referral/referral-rules.js';
import { Player } from '../../../../src/domain/players/player.entity.js';
import { DAY_MS, utcDay } from '../../../../src/domain/shared/time.js';

const MONDAY = new Date(Date.UTC(2026, 9, 19));
let rideSeq = 0;

class FakeClock extends ClockPort {
  constructor(public at: Date) { super(); }
  now(): Date { return this.at; }
}

class FakeTx extends TransactionPort {
  run<T>(fn: (tx: TransactionHandle) => Promise<T>): Promise<T> { return fn({} as TransactionHandle); }
}

class FakePlayers extends PlayerRepositoryPort {
  readonly locked: string[] = [];
  private readonly rows = new Map<string, Player>();
  add(wallet: string, freeRides = 0, trustScore = 50): void {
    this.rows.set(wallet, Player.restore({ wallet, version: 1, freeRides, freeDay: '2026-10-19', freeRidesMax: 1, createdAt: new Date(0), trustScore, tutorialPassedAt: null, age18At: null, lossAt: null }));
  }
  free(wallet: string): number { return this.rows.get(wallet)?.freeRides ?? -1; }
  findByWallet(wallet: string): Promise<Player | null> { return Promise.resolve(this.rows.get(wallet) ?? null); }
  findByWalletForUpdate(wallet: string): Promise<Player | null> { this.locked.push(wallet); return Promise.resolve(this.rows.get(wallet) ?? null); }
  insertIfAbsent(): Promise<boolean> { return Promise.resolve(false); }
  grantDailyFreeRides(): Promise<number> { return Promise.resolve(0); }
  save(player: Player): Promise<Player> { this.rows.set(player.wallet, player); return Promise.resolve(player); }
}

class FakeNames extends NameServicePort {
  constructor(private readonly map: Record<string, string> = {}) { super(); }
  reverse(wallet: string): Promise<string | null> { return Promise.resolve(this.map[wallet] ?? null); }
  reverseBatch(wallets: readonly string[]): Promise<Map<string, string | null>> { return Promise.resolve(new Map(wallets.map((wallet) => [wallet, this.map[wallet] ?? null]))); }
  resolve(): Promise<string | null> { return Promise.resolve(null); }
}

function harness(names: Record<string, string> = {}) {
  const clock = new FakeClock(MONDAY);
  const players = new FakePlayers();
  const repo = new MemoryConvoyRepository();
  const promos = new MemoryPromoRepository(new MemoryDb());
  const campaign = new MemoryAirdropRepository();
  const svc = new ConvoyService(repo, players, new FakeTx(), clock, new FakeNames(names), promos, campaign);
  return { clock, players, repo, svc, promos, campaign };
}

function fact(wallet: string, trip: string, status = 'completed', verdict = 'verified'): ConvoyRideFact {
  rideSeq += 1;
  return { rideId: `${wallet}-${rideSeq}`, wallet, status, verdict, trip };
}

describe('convoy rules', () => {
  it('counts only ranked paid tiers, excludes promos, and gates weekly grants at trust 100', () => {
    const paid = { tier: '1h', ranked: true };
    expect(countedRide(paid, 60, true)).toBe(true);
    expect(countedRide({ ...paid, tier: 'free' }, 100, true)).toBe(false);
    expect(countedRide({ ...paid, ranked: false }, 100, true)).toBe(false);
    expect(countedRide({ ...paid, promo: true }, 100, true)).toBe(false);
    expect(countedRide({ ...paid, weeklyGrant: true }, 99, true)).toBe(false);
    expect(countedRide({ ...paid, weeklyGrant: true }, 100, false)).toBe(false);
    expect(countedRide({ ...paid, weeklyGrant: true }, 100, true)).toBe(true);
    expect(countedRide({}, 100, true)).toBe(false);
  });
  it('caps pending slots at min(100, 5 + 2A)', () => {
    expect(pendingCap(0)).toBe(5);
    expect(pendingCap(1)).toBe(7);
    expect(pendingCap(47)).toBe(99);
    expect(pendingCap(48)).toBe(100);
    expect(pendingCap(100)).toBe(100);
  });

  it('retains historical +2/+3 arithmetic solely for old record interpretation', () => {
    const decision = qualifyDecision({
      status: 'pending', now: MONDAY, expiresAt: new Date(MONDAY.getTime() + DAY_MS), boundAt: MONDAY, alreadyFreeGranted: false, alreadyBadge: false,
      paid: false, level: 2, assist: false, windowDays: 7, weeklyGranted: 0, weeklyCap: 10, freeReferrer: 2, freeReferee: 3,
    });
    expect(decision.freeRides).toEqual({ referrer: 2, referee: 3 });
  });

  it('skips a promo at the daily, weekly, global and lifetime caps', () => {
    expect(promoDecision({ lifetime: false, day: 2, week: 9, globalWeek: 499 })).toBe('ok');
    expect(promoDecision({ lifetime: true, day: 0, week: 0, globalWeek: 0 })).toBe('lifetime');
    expect(promoDecision({ lifetime: false, day: 3, week: 0, globalWeek: 0 })).toBe('day');
    expect(promoDecision({ lifetime: false, day: 0, week: 10, globalWeek: 0 })).toBe('week');
    expect(promoDecision({ lifetime: false, day: 0, week: 0, globalWeek: 500 })).toBe('global');
  });

  it('activates on MEDIUM/HARD and gates milestones by campaign tasks and distinct weeks', () => {
    expect(isMediumOrHardTrip('free-2c')).toBe(true);
    expect(isMediumOrHardTrip('free-3')).toBe(true);
    expect(isMediumOrHardTrip('free-1c')).toBe(false);
    expect(isMediumOrHardTrip('1h')).toBe(false);
    const from = MONDAY;
    const until = new Date(MONDAY.getTime() + qualifyWindowMs());
    const rides = [0, 7, 14, 21, 28].map((day) => ({ at: new Date(MONDAY.getTime() + day * DAY_MS), counted: true }));
    expect(distinctWeeks(rides.slice(0, 2), from, until)).toBe(2);
    expect(milestoneDecision({ m1At: null, m2At: null, qualifyExpiresAt: until, now: rides[1]!.at, refereeWeeks: 2, tasksComplete: false })).toMatchObject({ m1: false, expire: false });
    expect(milestoneDecision({ m1At: null, m2At: null, qualifyExpiresAt: until, now: rides[1]!.at, refereeWeeks: 2, tasksComplete: true })).toMatchObject({ m1: true, m2: false });
    expect(milestoneDecision({ m1At: null, m2At: null, qualifyExpiresAt: until, now: rides[4]!.at, refereeWeeks: 5, tasksComplete: true })).toMatchObject({ m1: true, m2: true });
    const past = new Date(until.getTime() + 1);
    expect(milestoneDecision({ m1At: null, m2At: null, qualifyExpiresAt: until, now: past, refereeWeeks: 5, tasksComplete: true })).toMatchObject({ expire: true, m1: false });
    expect(milestoneDecision({ m1At: MONDAY, m2At: null, qualifyExpiresAt: until, now: past, refereeWeeks: 5, tasksComplete: true })).toMatchObject({ expire: false, m2: false });
  });
});

describe('ConvoyService', () => {
  it('qualifies when social tasks finish last, without inserting a synthetic ride or extending the window', async () => {
    const h = harness();
    h.players.add('host'); h.players.add('friend');
    await h.svc.bind('friend', 'host');
    await h.svc.onVerifiedRide(fact('friend', 'free-2c'));
    const paid = () => ({ ...fact('friend', '1h'), tier: '1h', ranked: true });
    await h.svc.onVerifiedRide(paid());
    h.clock.at = new Date(MONDAY.getTime() + 7 * DAY_MS);
    await h.svc.onVerifiedRide(paid());
    await h.svc.refreshMilestones('friend');
    expect((await h.repo.ledger()).filter(r => r.unit === 'ten4')).toHaveLength(0);
    await h.campaign.save({ ...emptyAirdrop('friend'), rideOk: true, telegramUserId: 'tg', telegramMember: true, telegramGroupMember: true, xUserId: 'x', xAgeOk: true, xFollowersOk: true, xFollows: true, xQuoteOk: true });
    await h.svc.refreshMilestones('friend');
    await h.svc.refreshMilestones('friend');
    expect((await h.repo.ledger()).filter(r => r.unit === 'ten4')).toEqual([expect.objectContaining({ kind: 'm1', at: h.clock.at, chainState: 'held' })]);
    expect(await h.repo.ridesOf('friend')).toHaveLength(3);
    h.clock.at = new Date(MONDAY.getTime() + qualifyWindowMs() + 1);
    await h.svc.refreshMilestones('friend');
    expect((await h.repo.getByReferee('friend'))?.status).toBe('qualified');
    await h.svc.refreshMilestones('no-invite');
  });

  it('earns only at referrer trust 50 and preserves an earned hold when trust later drops', async () => {
    const h = harness();
    h.players.add('host', 0, 49); h.players.add('friend');
    await h.svc.bind('friend', 'host');
    await h.svc.onVerifiedRide(fact('friend', 'free-2c'));
    await h.campaign.save({ ...emptyAirdrop('friend'), rideOk: true, telegramUserId: 'tg', telegramMember: true, telegramGroupMember: true, xUserId: 'x', xAgeOk: true, xFollowersOk: true, xFollows: true, xQuoteOk: true });
    await h.svc.onVerifiedRide({ ...fact('friend', '1h'), tier: '1h', ranked: true });
    h.clock.at = new Date(MONDAY.getTime() + 7 * DAY_MS);
    await h.svc.onVerifiedRide({ ...fact('friend', '1h'), tier: '1h', ranked: true });
    expect(await h.repo.findLedger('convoy:m1:friend')).toBeNull();
    h.players.add('host', 0, 50);
    await h.svc.refreshMilestones('friend');
    const earned = await h.repo.findLedger('convoy:m1:friend');
    expect(earned?.chainState).toBe('held');
    h.players.add('host', 0, 0);
    await h.svc.refreshMilestones('friend');
    expect(await h.repo.findLedger('convoy:m1:friend')).toEqual(earned);
    const before = await h.repo.getByReferee('friend');
    expect((await h.svc.bind('friend', 'host')).idempotent).toBe(true);
    expect(await h.repo.getByReferee('friend')).toEqual(before);
  });

  it('training never earns milestone weeks and recent counted activity expires from pending capacity', async () => {
    const h = harness();
    for (const wallet of ['ref', 'friend', 'next', 'later']) h.players.add(wallet);
    await h.svc.bind('friend', 'ref');
    await h.svc.onVerifiedRide(fact('friend', 'free-2c'));
    h.clock.at = new Date(MONDAY.getTime() + 7 * DAY_MS);
    await h.svc.onVerifiedRide(fact('friend', 'free-3c'));
    expect((await h.repo.ridesOf('friend')).every((ride) => !ride.counted)).toBe(true);
    expect((await h.repo.ledger()).filter((row) => row.unit === 'ten4')).toEqual([]);
    expect((await h.svc.bind('next', 'ref')).maxPending).toBe(5);
    const endedAt = h.clock.now();
    const paid = { ...fact('friend', '1h'), tier: '1h', ranked: true, endedAt };
    await h.svc.onVerifiedRide(paid);
    expect((await h.svc.bind('next', 'ref')).maxPending).toBe(7);
    h.clock.at = new Date(endedAt.getTime() + 30 * DAY_MS + 1);
    await h.svc.onVerifiedRide(paid);
    expect((await h.svc.bind('later', 'ref')).maxPending).toBe(5);
    expect((await h.repo.ridesOf('friend')).find((ride) => ride.rideId === paid.rideId)?.at).toEqual(endedAt);
  });
  it('binds a pending row under the player locks and refuses own, full, and missing wallets', async () => {
    const h = harness();
    h.players.add('aaa');
    h.players.add('mmm');
    const view = await h.svc.bind('aaa', 'mmm');
    expect(h.players.locked.slice(0, 2)).toEqual(['aaa', 'mmm']);
    expect(view).toMatchObject({ status: 'pending', pending: 1, maxPending: 5, idempotent: false, referrer: 'mmm' });
    expect(new Date(view.expiresAt).getTime() - MONDAY.getTime()).toBe(pendingTtlMs());
    expect((await h.svc.bind('aaa', 'mmm')).idempotent).toBe(true);
    h.players.add('other');
    await expect(h.svc.bind('aaa', 'other')).rejects.toMatchObject({ errorCode: 'already_bound' });
    await expect(h.svc.bind('mmm', 'mmm')).rejects.toMatchObject({ errorCode: 'own_code' });
    await expect(h.svc.bind('ghost', 'mmm')).rejects.toMatchObject({ errorCode: 'player_not_found' });
    for (let i = 0; i < 4; i++) { h.players.add(`p${i}`); await h.svc.bind(`p${i}`, 'mmm'); }
    h.players.add('overflow');
    await expect(h.svc.bind('overflow', 'mmm')).rejects.toMatchObject({ errorCode: 'no_slots' });
  });

  it('deletes a pending row after 72h so the invitee can bind again, and still activates at the exact deadline', async () => {
    const h = harness();
    h.players.add('ref');
    h.players.add('referee');
    h.players.add('next');
    const bound = await h.svc.bind('referee', 'ref');
    h.clock.at = new Date(new Date(bound.expiresAt).getTime() + 1);
    expect((await h.svc.onVerifiedRide(fact('referee', 'free-2c'))).deletedPending).toBe(true);
    expect(await h.repo.getByReferee('referee')).toBeNull();
    const again = await h.svc.bind('referee', 'next');
    expect(again.status).toBe('pending');
    h.clock.at = new Date(again.expiresAt);
    expect((await h.svc.onVerifiedRide(fact('referee', 'free-2c'))).activated).toBe(true);
  });

  it('activates only a verified MEDIUM or HARD ride and gifts one ride to the invitee', async () => {
    const h = harness();
    h.players.add('ref');
    h.players.add('referee');
    await h.svc.bind('referee', 'ref');
    expect((await h.svc.onVerifiedRide(fact('referee', 'free-1c'))).status).toBe('pending');
    expect((await h.svc.onVerifiedRide(fact('referee', '1h'))).status).toBe('pending');
    expect((await h.svc.onVerifiedRide(fact('referee', 'free-2c', 'completed', 'rejected'))).status).toBe('pending');
    expect((await h.svc.onVerifiedRide(fact('referee', 'free-3c', 'running', 'verified'))).status).toBe('pending');
    const progress = await h.svc.onVerifiedRide(fact('referee', 'free-2c'));
    expect(progress.activated).toBe(true);
    expect(progress.gift).toEqual({ granted: true, reason: 'ok', referrerRideGift: 0 });
    expect(h.players.free('referee')).toBe(0);
    expect(await h.promos.listUnspent('referee')).toEqual([expect.objectContaining({ tier: '1h', rideId: null })]);
    expect(h.players.free('ref')).toBe(0);
    const row = await h.repo.getByReferee('referee');
    expect(row?.status).toBe('active');
    expect(row?.qualifyExpiresAt?.getTime()).toBe(MONDAY.getTime() + qualifyWindowMs());
    const ledger = await h.repo.ledger();
    expect(ledger).toEqual([expect.objectContaining({ kind: 'promo_1h', wallet: 'referee', amount: 1, unit: 'ride' })]);
    expect(ledger.some((item) => item.wallet === 'ref' && item.unit === 'ride')).toBe(false);
    const again = await h.svc.onVerifiedRide(fact('referee', 'free-3'));
    expect(again.gift.reason).toBe('not_activation');
    expect(h.players.free('referee')).toBe(0);
    expect(await h.promos.listUnspent('referee')).toEqual([expect.objectContaining({ tier: '1h', rideId: null })]);
  });

  it('still activates when the promo cap is hit, and records no second ride credit', async () => {
    const h = harness();
    h.players.add('ref');
    const day = utcDay(MONDAY);
    const week = isoWeekKey(MONDAY);
    for (let i = 0; i < 3; i++) {
      await h.repo.insertLedger({ id: `day-${i}`, kind: 'promo_1h', wallet: `seed${i}`, referrer: 'ref', referee: `seed${i}`, amount: 1, unit: 'ride', at: MONDAY, dayKey: day, weekKey: week });
    }
    h.players.add('referee');
    await h.svc.bind('referee', 'ref');
    const progress = await h.svc.onVerifiedRide(fact('referee', 'free-3c'));
    expect(progress.activated).toBe(true);
    expect(progress.gift).toMatchObject({ granted: false, reason: 'day', referrerRideGift: 0 });
    expect(h.players.free('referee')).toBe(0);
    const weekly = harness();
    weekly.players.add('ref');
    weekly.players.add('referee');
    for (let i = 0; i < 10; i++) {
      await weekly.repo.insertLedger({ id: `week-${i}`, kind: 'promo_1h', wallet: `w${i}`, referrer: 'ref', referee: `w${i}`, amount: 1, unit: 'ride', at: MONDAY, dayKey: '2000-01-01', weekKey: week });
    }
    await weekly.svc.bind('referee', 'ref');
    expect((await weekly.svc.onVerifiedRide(fact('referee', 'free-2c'))).gift.reason).toBe('week');
    const global = harness();
    global.players.add('ref');
    global.players.add('referee');
    for (let i = 0; i < 500; i++) {
      await global.repo.insertLedger({ id: `g-${i}`, kind: 'promo_1h', wallet: `g${i}`, referrer: `other${i}`, referee: `g${i}`, amount: 1, unit: 'ride', at: MONDAY, dayKey: '2000-01-01', weekKey: week });
    }
    await global.svc.bind('referee', 'ref');
    expect((await global.svc.onVerifiedRide(fact('referee', 'free-2c'))).gift.reason).toBe('global');
    const lifetime = harness();
    lifetime.players.add('ref');
    lifetime.players.add('referee');
    await lifetime.repo.insertLedger({ id: 'convoy:promo:referee', kind: 'promo_1h', wallet: 'referee', referrer: 'ref', referee: 'referee', amount: 1, unit: 'ride', at: MONDAY, dayKey: '2000-01-01', weekKey: '2000-01-03' });
    await lifetime.svc.bind('referee', 'ref');
    expect((await lifetime.svc.onVerifiedRide(fact('referee', 'free-2c'))).gift.reason).toBe('lifetime');
    expect(lifetime.players.free('referee')).toBe(0);
  });

  it('writes M1 100 and M2 50 TEN4 ledger rows, then expires an active row that misses M1', async () => {
    const h = harness();
    h.players.add('ref');
    h.players.add('referee');
    await h.svc.onVerifiedRide(fact('ref', 'free-1c'));
    await h.svc.bind('referee', 'ref');
    await h.svc.onVerifiedRide(fact('referee', 'free-2c'));
    await h.svc.onVerifiedRide({ ...fact('referee', '1h'), tier: '1h', ranked: true });
    h.clock.at = new Date(MONDAY.getTime() + 7 * DAY_MS);
    expect((await h.svc.onVerifiedRide({ ...fact('referee', '1h'), tier: '1h', ranked: true })).milestones.m1).toBe(false);
    await h.campaign.save({ ...emptyAirdrop('referee'), rideOk: true, telegramUserId: 'tg', telegramMember: true, telegramGroupMember: true, xUserId: 'x', xAgeOk: true, xFollowersOk: true, xFollows: true, xQuoteOk: true });
    const held = await h.svc.onVerifiedRide({ ...fact('referee', '1h'), tier: '1h', ranked: true });
    expect(held.milestones.m1).toBe(true);
    h.clock.at = new Date(h.clock.at.getTime() + 48 * 3_600_000);
    const m1 = await h.svc.onVerifiedRide({ ...fact('referee', '1h'), tier: '1h', ranked: true });
    expect(m1).toMatchObject({ status: 'qualified', milestones: { m1: false, m2: false } });
    expect((await h.repo.ledger()).find((row) => row.kind === 'm1')).toMatchObject({ chainState: 'held', releasedAt: null });
    for (const day of [14, 21, 28]) {
      h.clock.at = new Date(MONDAY.getTime() + day * DAY_MS);
      await h.svc.onVerifiedRide({ ...fact('referee', '1h'), tier: '1h', ranked: true });
    }
    const ledger = await h.repo.ledger();
    expect(ledger.filter((row) => row.unit === 'ten4')).toEqual([
      expect.objectContaining({ kind: 'm1', wallet: 'ref', amount: 100 }),
      expect.objectContaining({ kind: 'm2', wallet: 'ref', amount: 50 }),
    ]);
    expect((await h.repo.getByReferee('referee'))?.status).toBe('qualified');
    const late = harness();
    late.players.add('ref');
    late.players.add('referee');
    late.players.add('next');
    await late.svc.bind('referee', 'ref');
    await late.svc.onVerifiedRide(fact('referee', 'free-2c'));
    late.clock.at = new Date(MONDAY.getTime() + qualifyWindowMs() + 1);
    expect((await late.svc.onVerifiedRide(fact('referee', 'free-2c'))).status).toBe('expired');
    await expect(late.svc.bind('referee', 'next')).rejects.toMatchObject({ errorCode: 'expired' });
    expect((await late.svc.expireDue())).toEqual({ deletedPending: 0, expiredActive: 0 });
  });

  it('sweeps expired pending rows and active rows past 60 days', async () => {
    const h = harness();
    h.players.add('ref');
    h.players.add('old');
    h.players.add('live');
    await h.svc.bind('old', 'ref');
    await h.svc.bind('live', 'ref');
    const pending = await h.repo.getByReferee('old');
    if (!pending) throw new Error('missing pending');
    pending.expiresAt = new Date(MONDAY.getTime() - 1);
    await h.repo.save(pending);
    await h.svc.onVerifiedRide(fact('live', 'free-2c'));
    const active = await h.repo.getByReferee('live');
    if (!active?.qualifyExpiresAt) throw new Error('missing active');
    active.qualifyExpiresAt = new Date(MONDAY.getTime() - 1);
    await h.repo.save(active);
    expect(await h.svc.expireDue()).toEqual({ deletedPending: 1, expiredActive: 1 });
    expect(await h.repo.getByReferee('old')).toBeNull();
    expect((await h.repo.getByReferee('live'))?.status).toBe('expired');
  });

  it('enforces the pending cap of 100', async () => {
    const h = harness();
    h.players.add('ref');
    for (let i = 0; i < 48; i++) {
      await h.repo.insert({ referee: `q${i}`, referrer: 'ref', status: 'qualified', boundAt: MONDAY, expiresAt: MONDAY, activatedAt: MONDAY, qualifyExpiresAt: MONDAY, m1At: MONDAY, m2At: null });
      await h.repo.recordRide({ rideId: `recent-${i}`, wallet: `q${i}`, at: MONDAY, trip: '1h', counted: true });
    }
    for (let i = 0; i < 100; i++) {
      h.players.add(`p${i}`);
      expect((await h.svc.bind(`p${i}`, 'ref')).maxPending).toBe(100);
    }
    h.players.add('overflow');
    await expect(h.svc.bind('overflow', 'ref')).rejects.toMatchObject({ errorCode: 'no_slots' });
  });

  it('ranks 25 referrers and omits hidden public rows while preserving the private row', async () => {
    const h = harness({ bee: 'bee.sol' });
    for (let i = 0; i < 26; i++) {
      const referrer = `r${String(i).padStart(2, '0')}`;
      for (let q = 0; q < i; q++) await h.repo.insert({ referee: `${referrer}-q${q}`, referrer, status: 'qualified', boundAt: MONDAY, expiresAt: MONDAY, activatedAt: MONDAY, qualifyExpiresAt: MONDAY, m1At: MONDAY, m2At: null });
      if (i % 2 === 0) await h.repo.insert({ referee: `${referrer}-a`, referrer, status: 'active', boundAt: MONDAY, expiresAt: MONDAY, activatedAt: MONDAY, qualifyExpiresAt: MONDAY, m1At: null, m2At: null });
    }
    const board = await h.svc.leaderboard('r00');
    expect(board.privacyColumn).toBe('missing');
    expect(board.rows).toHaveLength(25);
    expect(board.rows[0]).toMatchObject({ rank: 1, wallet: 'r25', qualified: 25 });
    expect(board.rows[24]?.wallet).toBe('r01');
    expect(board.me).toMatchObject({ rank: 26, wallet: 'r00', qualified: 0, active: 1 });
    const ties = harness({ bee: 'bee.sol' });
    ties.repo.columnPresent = true;
    const seed = async (referrer: string, qualified: number, active: number) => {
      for (let i = 0; i < qualified; i++) await ties.repo.insert({ referee: `${referrer}-q${i}`, referrer, status: 'qualified', boundAt: MONDAY, expiresAt: MONDAY, activatedAt: MONDAY, qualifyExpiresAt: MONDAY, m1At: MONDAY, m2At: null });
      for (let i = 0; i < active; i++) await ties.repo.insert({ referee: `${referrer}-a${i}`, referrer, status: 'active', boundAt: MONDAY, expiresAt: MONDAY, activatedAt: MONDAY, qualifyExpiresAt: MONDAY, m1At: null, m2At: null });
    };
    await seed('bee', 2, 0);
    await seed('aye', 2, 3);
    await seed('cee', 1, 9);
    ties.players.add('bee');
    expect(await ties.svc.setPrivacy('bee', true)).toEqual({ convoyHidden: true, column: 'present' });
    const ranked = await ties.svc.leaderboard('bee');
    expect(ranked.rows.map((row) => row.displayName)).toEqual(['aye', 'cee']);
    expect(ranked.me).toMatchObject({ wallet: 'bee', displayName: 'bee.sol', hidden: true, rank: 0 });
    const missing = harness();
    missing.players.add('bee');
    await missing.repo.insert({ referee: 'q', referrer: 'bee', status: 'qualified', boundAt: MONDAY, expiresAt: MONDAY, activatedAt: MONDAY, qualifyExpiresAt: MONDAY, m1At: MONDAY, m2At: null });
    expect(await missing.svc.setPrivacy('bee', true)).toEqual({ convoyHidden: false, column: 'missing' });
    expect((await missing.svc.leaderboard('bee')).rows[0]?.wallet).toBe('bee');
  });

  it('breaks equal-qualified ties by milestones, then the earliest achievement, rather than active invites', async () => {
    const h = harness();
    for (const [referrer, day, m2] of [['early', 1, false], ['late', 2, false], ['both', 3, true]] as const) {
      const when = new Date(MONDAY.getTime() + day * DAY_MS);
      await h.repo.insert({ referee: `${referrer}-friend`, referrer, status: 'qualified', boundAt: MONDAY, expiresAt: MONDAY, activatedAt: MONDAY, qualifyExpiresAt: when, m1At: when, m2At: m2 ? when : null });
    }
    for (let i = 0; i < 3; i++) await h.repo.insert({ referee: `late-active-${i}`, referrer: 'late', status: 'active', boundAt: MONDAY, expiresAt: MONDAY, activatedAt: MONDAY, qualifyExpiresAt: MONDAY, m1At: null, m2At: null });
    expect((await h.svc.leaderboard('early')).rows.map((row) => row.wallet)).toEqual(['both', 'early', 'late']);
  });
});
