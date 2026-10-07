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
    await repo.insertIfAbsent(Player.register('w', T0, 5));
    await repo.insertIfAbsent(Player.register('w', T0, 99));
    expect((await repo.findByWallet('w'))?.snapshot()).toEqual({ wallet: 'w', version: 1, freeRides: 5, freeDay: '2036-10-08', createdAt: T0 });
    expect(await repo.findByWallet('nobody')).toBeNull();
  });

  it('save bumps the version; a stale entity is a VersionConflictError', async () => {
    await repo.insertIfAbsent(Player.register('w', T0, 5));
    const a = (await repo.findByWallet('w')) as Player, stale = (await repo.findByWallet('w')) as Player;
    a.spendFreeRide();
    expect((await repo.save(a)).version).toBe(2);
    stale.refundFreeRide();
    await expect(repo.save(stale)).rejects.toBeInstanceOf(VersionConflictError);
    expect((await repo.findByWallet('w'))?.freeRides).toBe(4);
  });

  it('findByWalletForUpdate holds the row: a second transaction waits until the first commits', async () => {
    await repo.insertIfAbsent(Player.register('w', T0, 5));
    const order: string[] = [];
    const first = inTx(prisma, async (tx) => { await repo.findByWalletForUpdate('w', tx); order.push('first locked'); await sleep(300); order.push('first done'); });
    await sleep(50);
    const second = inTx(prisma, async (tx) => { await repo.findByWalletForUpdate('w', tx); order.push('second locked'); });
    await Promise.all([first, second]);
    expect(order).toEqual(['first locked', 'first done', 'second locked']);
  });
});
