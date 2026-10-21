import { PlayerPrismaRepository } from '../../../src/infrastructure/prisma/repositories/player.prisma.repository.js';
import { Player } from '../../../src/domain/players/player.entity.js';
import { VersionConflictError } from '../../../src/domain/shared/errors.js';
import type { PrismaService } from '../../../src/infrastructure/prisma/prisma.service.js';
import { T0, inTx, sleep, testPrisma, wipe } from '../../support/db.js';

describe('PlayerPrismaRepository (PostgreSQL)', () => {
  let prisma: PrismaService, repo: PlayerPrismaRepository;
  beforeAll(async () => { prisma = await testPrisma(); repo = new PlayerPrismaRepository(prisma); });
  afterAll(() => prisma.$disconnect());
  beforeEach(() => wipe(prisma));

  it('insertIfAbsent creates once and is a no-op afterwards; findByWallet maps the row back', async () => {
    await repo.insertIfAbsent(Player.register('w', T0, 5, 5));
    await repo.insertIfAbsent(Player.register('w', T0, 99, 5));
    expect((await repo.findByWallet('w'))?.snapshot()).toEqual({ wallet: 'w', version: 1, freeRides: 5, freeDay: '2036-10-08', freeRidesMax: 5, createdAt: T0, tutorialPassedAt: null, age18At: null, lossAt: null, guest: false, trustScore: 60, termsVersion: 1, privacyVersion: 1, rejectedRides: 0 });
    expect(await repo.findByWallet('nobody')).toBeNull();
  });

  it('save bumps the version; a stale entity is a VersionConflictError', async () => {
    await repo.insertIfAbsent(Player.register('w', T0, 5, 5));
    const a = (await repo.findByWallet('w')) as Player, stale = (await repo.findByWallet('w')) as Player;
    a.spendFreeRide();
    expect((await repo.save(a)).version).toBe(2);
    stale.refundFreeRide();
    await expect(repo.save(stale)).rejects.toBeInstanceOf(VersionConflictError);
    expect((await repo.findByWallet('w'))?.freeRides).toBe(4);
  });

  it('save writes a changed daily cap and still refuses a stale version', async () => {
    await repo.insertIfAbsent(Player.register('w', T0, 5, 5));
    const p = (await repo.findByWallet('w')) as Player;
    expect(p.setDailyCap(3)).toBe(true);
    p.spendFreeRide();
    await repo.save(p);
    expect((await repo.findByWallet('w'))?.snapshot()).toMatchObject({ freeRides: 4, freeRidesMax: 3, version: 2 });
    const stale = Player.restore(p.snapshot());
    stale.setDailyCap(9);
    await expect(repo.save(stale)).rejects.toBeInstanceOf(VersionConflictError);
    expect((await repo.findByWallet('w'))?.freeRidesMax).toBe(3);
  });

  it('the tutorial stamp is saved with the player (null for a new one) and read back', async () => {
    await repo.insertIfAbsent(Player.register('w', T0, 5, 5));
    expect((await repo.findByWallet('w'))?.tutorialPassedAt).toBeNull();
    const p = (await repo.findByWallet('w')) as Player;
    expect(p.markTutorialPassed(T0)).toBe(true);
    await repo.save(p);
    expect((await repo.findByWallet('w'))).toMatchObject({ tutorialPassed: true, tutorialPassedAt: T0 });
  });

  it('the agreement stamps round-trip, and clearing a box writes null', async () => {
    await repo.insertIfAbsent(Player.register('w', T0, 5, 5));
    const p = (await repo.findByWallet('w')) as Player;
    expect(p.setAgreements({ age18: true, loss: true }, T0).becameAccepted).toBe(true);
    await repo.save(p);
    const back = (await repo.findByWallet('w')) as Player;
    expect(back).toMatchObject({ age18At: T0, lossAt: T0 });
    back.setAgreements({ age18: false, loss: true }, T0);
    await repo.save(back);
    expect((await repo.findByWallet('w'))?.snapshot()).toMatchObject({ age18At: null, lossAt: T0, version: 3 });
  });

  describe('grantDailyFreeRides is retired', () => {
    it('does not move balance, day or version', async () => {
      await repo.insertIfAbsent(Player.restore({ wallet: 'low', version: 1, freeRides: 2, freeDay: '2036-10-08', freeRidesMax: 5, createdAt: T0, tutorialPassedAt: null, age18At: null, lossAt: null }));
      expect(await repo.grantDailyFreeRides('2036-10-09', 5)).toBe(0);
      expect((await repo.findByWallet('low'))?.snapshot()).toMatchObject({ freeRides: 2, freeDay: '2036-10-08', version: 1 });
    });
  });

  it('findByWalletForUpdate holds the row: a second transaction waits until the first commits', async () => {
    await repo.insertIfAbsent(Player.register('w', T0, 5, 5));
    const order: string[] = [];
    const first = inTx(prisma, async (tx) => { await repo.findByWalletForUpdate('w', tx); order.push('first locked'); await sleep(300); order.push('first done'); });
    await sleep(50);
    const second = inTx(prisma, async (tx) => { await repo.findByWalletForUpdate('w', tx); order.push('second locked'); });
    await Promise.all([first, second]);
    expect(order).toEqual(['first locked', 'first done', 'second locked']);
  });
});
