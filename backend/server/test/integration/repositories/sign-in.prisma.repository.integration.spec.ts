import { SignInPrismaRepository } from '../../../src/infrastructure/prisma/repositories/sign-in.prisma.repository.js';
import type { PrismaService } from '../../../src/infrastructure/prisma/prisma.service.js';
import { T0, at, seedPlayer, testPrisma, wipe } from '../../support/db.js';

describe('SignInPrismaRepository (PostgreSQL)', () => {
  let prisma: PrismaService, repo: SignInPrismaRepository;
  beforeAll(async () => { prisma = await testPrisma(); repo = new SignInPrismaRepository(prisma); });
  afterAll(() => prisma.$disconnect());
  beforeEach(async () => { await wipe(prisma); await seedPlayer(prisma, 'alice'); await seedPlayer(prisma, 'bob'); });

  it('stores sign-ins and lists them newest first (equal times: the later insert first), per wallet, with a limit; counts since a time', async () => {
    await repo.insert({ wallet: 'alice', at: T0, ipHash: '1.1.1.1' });
    await repo.insert({ wallet: 'bob', at: at(60), ipHash: null });
    await repo.insert({ wallet: 'alice', at: at(60), ipHash: '2.2.2.2' });
    expect((await repo.recent(10)).map((s) => [s.wallet, s.ipHash])).toEqual([['alice', '2.2.2.2'], ['bob', null], ['alice', '1.1.1.1']]);
    expect(await repo.recent(10, 'alice')).toEqual([{ wallet: 'alice', at: at(60), ipHash: '2.2.2.2' }, { wallet: 'alice', at: T0, ipHash: '1.1.1.1' }]);
    expect(await repo.recent(1)).toHaveLength(1);
    expect(await repo.countSince(at(30))).toBe(2);
  });

  it('summaryOf: per wallet asked for, the first kept sign-in and every distinct IP (no nulls); wallets without sign-ins are left out', async () => {
    await seedPlayer(prisma, 'carol');
    await repo.insert({ wallet: 'alice', at: at(60), ipHash: '2.2.2.2' });
    await repo.insert({ wallet: 'alice', at: T0, ipHash: '1.1.1.1' });
    await repo.insert({ wallet: 'alice', at: at(90), ipHash: '2.2.2.2' });
    await repo.insert({ wallet: 'alice', at: at(95), ipHash: null });
    await repo.insert({ wallet: 'bob', at: at(30), ipHash: null });
    await repo.insert({ wallet: 'carol', at: at(10), ipHash: '9.9.9.9' });
    expect(await repo.summaryOf(['bob', 'alice', 'nobody'])).toEqual([{ wallet: 'alice', firstAt: T0, ips: ['1.1.1.1', '2.2.2.2'] }, { wallet: 'bob', firstAt: at(30), ips: [] }]);
    expect(await repo.summaryOf([])).toEqual([]);
  });

  it('deleteBefore removes the rows older than the cutoff (retention of IP addresses) and returns how many', async () => {
    await repo.insert({ wallet: 'alice', at: T0, ipHash: '1.1.1.1' });
    await repo.insert({ wallet: 'bob', at: at(100), ipHash: '2.2.2.2' });
    expect(await repo.deleteBefore(at(50))).toBe(1);
    expect((await repo.recent(10)).map((s) => s.ipHash)).toEqual(['2.2.2.2']);
    expect(await repo.deleteBefore(at(50))).toBe(0);
  });

  it('a player\'s sign-ins go with the player (cascade)', async () => {
    await repo.insert({ wallet: 'bob', at: T0, ipHash: null });
    await prisma.player.delete({ where: { wallet: 'bob' } });
    expect(await prisma.signIn.count()).toBe(0);
  });
});
