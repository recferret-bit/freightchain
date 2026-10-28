import { RideVerdictPrismaRepository } from '../../../src/infrastructure/prisma/repositories/ride-verdict.prisma.repository.js';
import { RidePrismaRepository } from '../../../src/infrastructure/prisma/repositories/ride.prisma.repository.js';
import { EventSettlementPrismaRepository } from '../../../src/infrastructure/prisma/repositories/event-settlement.prisma.repository.js';
import type { EventWinnerRecord } from '../../../src/application/ports/prize/event-settlement.repository.port.js';
import type { PrismaService } from '../../../src/infrastructure/prisma/prisma.service.js';
import { Ride } from '../../../src/domain/rides/ride.entity.js';
import { RideStatus } from '../../../src/domain/rides/ride-status.js';
import { RideVerdict } from '../../../src/domain/verdict/ride-verdict.entity.js';
import { VerdictStatus } from '../../../src/domain/verdict/verdict.dto.js';
import { PRESEASON_PROMO_CODE } from '../../../src/domain/settings/preseason-event.js';
import { T0, at, inTx, rideId, seedPlayer, testPrisma, wipe } from '../../support/db.js';

const EVENT = 'preseason-2026-11';
const WINDOW = { start: at(-10_000), end: at(-100) };
const winner = (wallet: string, place: number): EventWinnerRecord => ({ wallet, place, amountCents: 1000 * place, bps: 9000, rideId: `r-${wallet}`, lockedAt: T0, txSignature: null, paidAt: null, recordedBy: null });

describe('EventSettlementPrismaRepository (PostgreSQL)', () => {
  let prisma: PrismaService, repo: EventSettlementPrismaRepository, rides: RidePrismaRepository, verdicts: RideVerdictPrismaRepository;
  beforeAll(async () => { prisma = await testPrisma(); repo = new EventSettlementPrismaRepository(prisma); rides = new RidePrismaRepository(prisma); verdicts = new RideVerdictPrismaRepository(prisma); });
  afterAll(() => prisma.$disconnect());
  beforeEach(() => wipe(prisma));

  async function ride(wallet: string, o: { bps?: number; verdict?: VerdictStatus | null; promo?: string | null; ranked?: boolean; status?: RideStatus; endedAt?: Date; startedAt?: Date; country?: string | null } = {}): Promise<string> {
    const id = rideId();
    const base = Ride.createPromo({ id, wallet, tier: '1h', seed: 1, minSeconds: 3600, timeScale: 1, promoCode: PRESEASON_PROMO_CODE, now: T0 });
    await rides.insert(Ride.restore({
      ...base.snapshot(), promoCode: o.promo === undefined ? PRESEASON_PROMO_CODE : o.promo, ranked: o.ranked ?? true, status: o.status ?? RideStatus.Completed, lastS: 10_000, completeDist: 10_000, cleanMetres: o.bps ?? 9000,
      prizeCountry: o.country === undefined ? 'KZ' : o.country, startedAt: o.startedAt ?? at(-5000), endedAt: o.endedAt ?? at(-500),
    }));
    if (o.verdict !== null) await verdicts.save(RideVerdict.restore({ rideId: id, status: o.verdict ?? VerdictStatus.Verified, reasons: [], scores: {} as never, rulesVersion: 4, judgedAt: T0, version: 1 }));
    return id;
  }

  it('lists only completed, ranked, 1h, event-promo rides with a VERIFIED verdict that ended inside the window; one row per wallet (best, earliest)', async () => {
    for (const w of ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']) await seedPlayer(prisma, w);
    const good = await ride('a', { bps: 9100 });
    await ride('b', { verdict: VerdictStatus.Flagged });
    await ride('c', { verdict: null });
    await ride('d', { promo: null });
    await ride('e', { ranked: false });
    await ride('f', { status: RideStatus.Abandoned });
    await ride('g', { endedAt: at(+50) });
    await ride('h', { startedAt: at(-20_000), country: null });   // started before the window
    await ride('a', { bps: 5000 });
    const rows = await repo.listCandidates(WINDOW);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ wallet: 'a', rideId: good, bps: 9100, country: 'KZ', trustScore: 60, attempts: 2 });
  });

  it('keeps the review flags per event and wallet, and overwrites the latest check', async () => {
    await inTx(prisma, (t) => repo.saveReview(EVENT, { wallet: 'a', disqualified: true, prizeEligibleOverride: false, note: 'n', sanctionsCheckedAt: null, sanctionsClean: null, sanctionsRef: null, updatedBy: 'adm', updatedAt: T0 }, t));
    await inTx(prisma, (t) => repo.saveReview(EVENT, { wallet: 'a', disqualified: false, prizeEligibleOverride: null, note: null, sanctionsCheckedAt: T0, sanctionsClean: true, sanctionsRef: 'x', updatedBy: 'adm', updatedAt: at(5) }, t));
    expect(await repo.review(EVENT, 'a')).toEqual({ wallet: 'a', disqualified: false, prizeEligibleOverride: null, note: null, sanctionsCheckedAt: T0, sanctionsClean: true, sanctionsRef: 'x', updatedBy: 'adm', updatedAt: at(5) });
    expect(await repo.review('other', 'a')).toBeNull();
    expect(await repo.reviews(EVENT)).toHaveLength(1);
  });

  it('stores the prize table until the list is locked; locking is once and writes the winners with it', async () => {
    expect(await repo.state(EVENT)).toEqual({ prizeTableCents: null, lockedAt: null, lockedBy: null });
    expect(await inTx(prisma, (t) => repo.setPrizeTable(EVENT, [500, 300], T0, t))).toBe(true);
    expect((await repo.state(EVENT)).prizeTableCents).toEqual([500, 300]);
    expect(await inTx(prisma, (t) => repo.lock(EVENT, 'adm', at(9), [winner('a', 1), winner('b', 2)], t))).toBe(true);
    expect(await repo.state(EVENT)).toEqual({ prizeTableCents: [500, 300], lockedAt: at(9), lockedBy: 'adm' });
    expect(await inTx(prisma, (t) => repo.lock(EVENT, 'adm', at(10), [winner('c', 3)], t))).toBe(false);
    expect(await inTx(prisma, (t) => repo.setPrizeTable(EVENT, [1], at(11), t))).toBe(false);
    expect((await repo.winners(EVENT)).map((w) => w.wallet)).toEqual(['a', 'b']);
    expect((await repo.state(EVENT)).prizeTableCents).toEqual([500, 300]);
  });

  it('locking an event that has no config row yet creates it with the default table (null)', async () => {
    expect(await inTx(prisma, (t) => repo.lock(EVENT, 'adm', T0, [], t))).toBe(true);
    expect(await repo.state(EVENT)).toEqual({ prizeTableCents: null, lockedAt: T0, lockedBy: 'adm' });
  });

  it('records a payout once per winner and once per signature', async () => {
    await inTx(prisma, (t) => repo.lock(EVENT, 'adm', T0, [winner('a', 1), winner('b', 2)], t));
    expect(await inTx(prisma, (t) => repo.recordPayout(EVENT, 'zzz', 's1', 'adm', T0, t))).toBe('not_a_winner');
    expect(await inTx(prisma, (t) => repo.recordPayout(EVENT, 'a', 's1', 'adm', at(1), t))).toBe('recorded');
    expect(await inTx(prisma, (t) => repo.recordPayout(EVENT, 'a', 's2', 'adm', at(2), t))).toBe('already_paid');
    expect(await inTx(prisma, (t) => repo.recordPayout(EVENT, 'b', 's1', 'adm', at(3), t))).toBe('signature_used');
    expect((await repo.winners(EVENT))[0]).toMatchObject({ wallet: 'a', txSignature: 's1', paidAt: at(1), recordedBy: 'adm' });
    expect((await repo.winners(EVENT))[1]).toMatchObject({ wallet: 'b', txSignature: null });
  });

  it('races: two transactions recording the same winner or the same signature leave exactly one record', async () => {
    await inTx(prisma, (t) => repo.lock(EVENT, 'adm', T0, [winner('a', 1), winner('b', 2)], t));
    const attempt = (wallet: string, sig: string) => inTx(prisma, (t) => repo.recordPayout(EVENT, wallet, sig, 'adm', T0, t)).catch(() => 'aborted');
    const sameWinner = await Promise.all([attempt('a', 'x1'), attempt('a', 'x2'), attempt('a', 'x3')]);
    expect(sameWinner.filter((r) => r === 'recorded')).toHaveLength(1);
    const sameSig = await Promise.all([attempt('b', 'y'), attempt('b', 'y')]);
    expect(sameSig.filter((r) => r === 'recorded')).toHaveLength(1);
    const sigs = (await repo.winners(EVENT)).map((w) => w.txSignature).filter(Boolean);
    expect(new Set(sigs).size).toBe(sigs.length);
  });
});
