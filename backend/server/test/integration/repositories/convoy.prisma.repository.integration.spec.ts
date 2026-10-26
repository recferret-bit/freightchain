import { ConvoyPrismaRepository } from '../../../src/infrastructure/prisma/repositories/convoy.prisma.repository.js';
import type { ConvoyRow } from '../../../src/application/referral/convoy.repository.port.js';
import type { PrismaService } from '../../../src/infrastructure/prisma/prisma.service.js';
import { at, inTx, seedPlayer, testPrisma, wipe } from '../../support/db.js';

describe('ConvoyPrismaRepository', () => {
  let prisma: PrismaService;
  let repo: ConvoyPrismaRepository;
  const row: ConvoyRow = { referee: 'friend', referrer: 'host', status: 'pending', boundAt: at(0), expiresAt: at(100), activatedAt: null, qualifyExpiresAt: null, m1At: null, m2At: null };
  beforeAll(async () => { prisma = await testPrisma(); repo = new ConvoyPrismaRepository(prisma); });
  afterAll(() => prisma.$disconnect());
  beforeEach(async () => { await wipe(prisma); await seedPlayer(prisma, 'host'); await seedPlayer(prisma, 'friend'); });

  it('persists invitations, ride evidence, held credits and privacy across independent connections', async () => {
    await inTx(prisma, async (tx) => {
      expect(await repo.insert(row, tx)).toBe(true);
      expect(await repo.insert(row, tx)).toBe(false);
      await repo.recordRide({ rideId: 'r1', wallet: 'friend', at: at(10), trip: 'free-2c', counted: true }, tx);
      await repo.recordRide({ rideId: 'r1', wallet: 'friend', at: at(99), trip: null, counted: false }, tx);
      expect(await repo.insertLedger({ id: 'm1', kind: 'm1', wallet: 'host', referrer: 'host', referee: 'friend', amount: 100, unit: 'ten4', at: at(10), dayKey: '2036-10-08', weekKey: '2036-10-06', releasedAt: null }, tx)).toBe(true);
      await repo.writeHidden('host', true, tx);
    });
    const other = await testPrisma();
    try {
      const restarted = new ConvoyPrismaRepository(other);
      expect(await restarted.getByReferee('friend')).toEqual({ ...row, policy: null });
      expect(await restarted.readHidden('host')).toEqual({ columnPresent: true, hidden: true });
      expect(await restarted.ridesOf('friend')).toEqual([{ rideId: 'r1', wallet: 'friend', at: at(10), trip: 'free-2c', counted: true }]);
      expect(await restarted.releaseLedger('m1', at(30))).toBe(true);
      expect(await repo.releaseLedger('m1', at(40))).toBe(false);
      expect((await repo.ledger())[0]?.releasedAt).toEqual(at(30));
    } finally { await other.$disconnect(); }
  });

  it('persists activation promises independently of later settings', async () => {
    const policy = { m1Amount: 75, m1Weeks: 3, m2Amount: 25, m2Weeks: 6, minTrust: 80, promoRanked: 1 };
    await repo.insert({ ...row, status: 'active', activatedAt: at(1), policy });
    await prisma.gameSetting.upsert({ where: { key: 'referral_ten4_m1_amount' }, create: { key: 'referral_ten4_m1_amount', value: 200 }, update: { value: 200 } });
    const other = await testPrisma();
    try { expect((await new ConvoyPrismaRepository(other).getByReferee('friend'))?.policy).toEqual(policy); }
    finally { await other.$disconnect(); }
  });

  it('rolls back the invitation, evidence, privacy and credit together', async () => {
    await expect(inTx(prisma, async (tx) => {
      await repo.insert(row, tx);
      await repo.recordRide({ rideId: 'r1', wallet: 'friend', at: at(0), trip: 'free-2c', counted: true }, tx);
      await repo.writeHidden('host', true, tx);
      await repo.insertLedger({ id: 'm1', kind: 'm1', wallet: 'host', referrer: 'host', referee: 'friend', amount: 100, unit: 'ten4', at: at(0), dayKey: 'd', weekKey: 'w' }, tx);
      throw new Error('rollback');
    })).rejects.toThrow('rollback');
    expect(await repo.getByReferee('friend')).toBeNull();
    expect(await repo.ridesOf('friend')).toEqual([]);
    expect(await repo.ledger()).toEqual([]);
    expect((await repo.readHidden('host')).hidden).toBe(false);
  });

  it('counts each active friend once inside the inclusive recent window, excluding training and future evidence', async () => {
    await repo.insert({ ...row, status: 'active' });
    const fact = { wallet: 'friend', trip: '1h', counted: true };
    await repo.recordRide({ ...fact, rideId: 'old', at: at(9) });
    await repo.recordRide({ ...fact, rideId: 'future', at: at(21) });
    await repo.recordRide({ ...fact, rideId: 'training', at: at(15), counted: false });
    expect(await repo.recentActiveCount('host', at(10), at(20))).toBe(0);
    await repo.recordRide({ ...fact, rideId: 'first', at: at(10) });
    await repo.recordRide({ ...fact, rideId: 'second', at: at(20) });
    expect(await repo.recentActiveCount('host', at(10), at(20))).toBe(1);
    expect(await repo.recentActiveCount('other', at(10), at(20))).toBe(0);
    await repo.save({ ...row, status: 'expired' });
    expect(await repo.recentActiveCount('host', at(10), at(20))).toBe(0);
  });

  it('keeps exact expiry boundaries and aggregates only active and qualified invitations', async () => {
    await repo.insert(row);
    expect(await repo.listPendingExpired(at(100))).toEqual([]);
    expect(await repo.listPendingExpired(at(101))).toEqual([{ ...row, policy: null }]);
    await repo.save({ ...row, status: 'active', activatedAt: at(1), qualifyExpiresAt: at(200) });
    expect(await repo.listActivePast(at(200))).toEqual([]);
    expect(await repo.listActivePast(at(201))).toHaveLength(1);
    expect(await repo.referrerCounts()).toEqual([{ referrer: 'host', active: 1, qualified: 0, milestones: 0, firstMilestone: null }]);
    await repo.save({ ...row, status: 'qualified', m1At: at(2) });
    expect(await repo.referrerCounts()).toEqual([{ referrer: 'host', active: 0, qualified: 1, milestones: 1, firstMilestone: at(2) }]);
    expect(await repo.listByReferrer('host')).toHaveLength(1);
    expect(await repo.deleteReferee('friend')).toBe(true);
    expect(await repo.deleteReferee('friend')).toBe(false);
  });
});
