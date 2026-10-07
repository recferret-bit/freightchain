import { TransactionPrismaAdapter } from '../../../src/infrastructure/prisma/transaction.prisma.adapter.js';
import { PlayerPrismaRepository } from '../../../src/infrastructure/prisma/repositories/player.prisma.repository.js';
import { Player } from '../../../src/domain/players/player.entity.js';
import type { PrismaService } from '../../../src/infrastructure/prisma/prisma.service.js';
import { T0, testPrisma, wipe } from '../../support/db.js';

describe('TransactionPrismaAdapter (PostgreSQL)', () => {
  let prisma: PrismaService, tx: TransactionPrismaAdapter, players: PlayerPrismaRepository;
  beforeAll(async () => { prisma = await testPrisma(); tx = new TransactionPrismaAdapter(prisma); players = new PlayerPrismaRepository(prisma); });
  afterAll(() => prisma.$disconnect());
  beforeEach(() => wipe(prisma));

  it('commits everything the callback did, and returns its value', async () => {
    expect(await tx.run(async (h) => { await players.insertIfAbsent(Player.register('a', T0, 5), h); await players.insertIfAbsent(Player.register('b', T0, 5), h); return 'done'; })).toBe('done');
    expect(await prisma.player.count()).toBe(2);
  });

  it('rolls everything back when the callback throws', async () => {
    await expect(tx.run(async (h) => { await players.insertIfAbsent(Player.register('a', T0, 5), h); throw new Error('boom'); })).rejects.toThrow('boom');
    expect(await prisma.player.count()).toBe(0);
  });
});
