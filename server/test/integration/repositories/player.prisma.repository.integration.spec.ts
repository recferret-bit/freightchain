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
    expect((await repo.findByWallet('w'))?.snapshot()).toEqual({ wallet: 'w', version: 1, freeRides: 5, freeDay: '2036-10-08', freeRidesMax: 5, createdAt: T0, tutorialPassedAt: null });
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

  describe('grantDailyFreeRides – the midnight bulk update', () => {
    const seed = async (wallet: string, freeRides: number, freeDay = '2036-10-08', freeRidesMax = 5) => {
      await repo.insertIfAbsent(Player.restore({ wallet, version: 1, freeRides, freeDay, freeRidesMax, createdAt: T0, tutorialPassedAt: null }));
    };

    it('adds one below the cap, stops at the cap, leaves an over-cap balance, stamps the day and bumps the version', async () => {
      await seed('low', 2); await seed('edge', 4); await seed('full', 5); await seed('over', 8); await seed('bigcap', 5, '2036-10-08', 7);
      expect(await repo.grantDailyFreeRides('2036-10-09')).toBe(5);
      const got = async (w: string) => (await repo.findByWallet(w))?.snapshot();
      expect(await got('low')).toMatchObject({ freeRides: 3, freeDay: '2036-10-09', version: 2 });
      expect(await got('edge')).toMatchObject({ freeRides: 5 });
      expect(await got('full')).toMatchObject({ freeRides: 5, freeDay: '2036-10-09', version: 2 });
      expect(await got('over')).toMatchObject({ freeRides: 8 });
      expect(await got('bigcap')).toMatchObject({ freeRides: 6 });
    });

    it('is idempotent for a day, and a skipped night still gives ONE credit', async () => {
      await seed('a', 1); await seed('b', 1, '2036-10-01');
      expect(await repo.grantDailyFreeRides('2036-10-09')).toBe(2);
      expect(await repo.grantDailyFreeRides('2036-10-09')).toBe(0);
      expect((await repo.findByWallet('a'))?.freeRides).toBe(2);
      expect((await repo.findByWallet('b'))?.freeRides).toBe(2);
    });

    it('never moves back: a player already stamped for a later day is untouched', async () => {
      await seed('a', 1, '2036-10-12');
      expect(await repo.grantDailyFreeRides('2036-10-09')).toBe(0);
      expect((await repo.findByWallet('a'))?.freeRides).toBe(1);
    });

    it('makes a stale optimistic save lose (the version moved), so a lazy touch re-reads instead of overwriting the grant', async () => {
      await seed('a', 1);
      const stale = (await repo.findByWallet('a')) as Player;
      await repo.grantDailyFreeRides('2036-10-09');
      stale.spendFreeRide();
      await expect(repo.save(stale)).rejects.toBeInstanceOf(VersionConflictError);
      expect((await repo.findByWallet('a'))?.freeRides).toBe(2);
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
