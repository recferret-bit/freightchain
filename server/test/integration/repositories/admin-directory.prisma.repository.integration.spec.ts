import { AdminDirectoryPrismaRepository } from '../../../src/infrastructure/prisma/repositories/admin-directory.prisma.repository.js';
import { PoolPrismaRepository } from '../../../src/infrastructure/prisma/repositories/pool.prisma.repository.js';
import type { PrismaService } from '../../../src/infrastructure/prisma/prisma.service.js';
import { at, seedPlayer, testPrisma, wipe } from '../../support/db.js';
import { aPool } from '../../support/pools.js';

describe('AdminDirectoryPrismaRepository (PostgreSQL)', () => {
  let prisma: PrismaService, dir: AdminDirectoryPrismaRepository, pools: PoolPrismaRepository;
  beforeAll(async () => { prisma = await testPrisma(); dir = new AdminDirectoryPrismaRepository(prisma); pools = new PoolPrismaRepository(prisma); });
  afterAll(() => prisma.$disconnect());
  beforeEach(() => wipe(prisma));

  const stats = (wallet: string, rides: number, metres: number) => prisma.playerStats.create({ data: { wallet, rides, ridesFree: rides, metres, seconds: metres / 28, updatedAt: at(0) } });

  it('players: newest first, a wallet prefix filters, the balance, rides driven, unused tickets over every pool and the newest sign-in', async () => {
    for (const w of ['Alice1', 'Alice2', 'Bob3']) await seedPlayer(prisma, w);
    await prisma.player.update({ where: { wallet: 'Alice2' }, data: { createdAt: at(100) } });
    await prisma.player.update({ where: { wallet: 'Bob3' }, data: { createdAt: at(200) } });
    await pools.upsert(aPool({ id: 1 }, at(0)));
    await pools.upsert(aPool({ id: 2 }, at(0)));
    await prisma.rideTicket.create({ data: { wallet: 'Alice2', poolId: 1, balance: 2, bought: 3 } });
    await prisma.rideTicket.create({ data: { wallet: 'Alice2', poolId: 2, balance: 1, bought: 1 } });
    await prisma.signIn.create({ data: { wallet: 'Alice2', at: at(10) } });
    await prisma.signIn.create({ data: { wallet: 'Alice2', at: at(50) } });
    await stats('Alice2', 4, 560);
    const rows = await dir.players(undefined, 10);
    expect(rows.map((r) => r.wallet)).toEqual(['Bob3', 'Alice2', 'Alice1']);
    expect(rows[1]).toMatchObject({ wallet: 'Alice2', rides: 4, tickets: 3, lastSignInAt: at(50).getTime(), createdAt: at(100).getTime() });
    expect(rows[0]).toMatchObject({ rides: 0, tickets: 0, lastSignInAt: null });
    expect((await dir.players('Alice', 10)).map((r) => r.wallet)).toEqual(['Alice2', 'Alice1']);
    expect(await dir.players('alice', 10)).toEqual([]);
    expect(await dir.players(undefined, 1)).toHaveLength(1);
  });

  it('pools: newest first with lamports above 2^31 intact; pool(id) adds the split, treasuries and the holders (most bought first); an unknown id is null', async () => {
    await pools.upsert(aPool({ id: 1, createdAt: at(0) }, at(0)));
    await pools.upsert(aPool({ id: 2, createdAt: at(60), priceLamports: 3_000_000_000, vaultLamports: 9_000_000_000, sponsored: 2_500_000_000, status: 'active', ticketsSold: 4, buyers: 2 }, at(60)));
    for (const w of ['a', 'b']) await seedPlayer(prisma, w);
    await prisma.rideTicket.create({ data: { wallet: 'a', poolId: 2, balance: 1, bought: 1 } });
    await prisma.rideTicket.create({ data: { wallet: 'b', poolId: 2, balance: 0, bought: 3 } });
    const rows = await dir.pools(10);
    expect(rows.map((r) => r.id)).toEqual([2, 1]);
    expect(rows[0]).toMatchObject({ priceLamports: 3_000_000_000, vaultLamports: 9_000_000_000, sponsored: 2_500_000_000, status: 'active', ticketsSold: 4, buyers: 2, syncedAt: null });
    expect(await dir.pools(1)).toHaveLength(1);
    const d = await dir.pool(2);
    expect(d?.pool).toMatchObject({ id: 2, prizeBps: 7000, seedBps: 2000, feeBps: 1000 });
    expect(d?.holders).toEqual([{ wallet: 'b', balance: 0, bought: 3 }, { wallet: 'a', balance: 1, bought: 1 }]);
    expect(await dir.pool(99)).toBeNull();
  });

  it('topRiders: by metres, riders without a ride left out, the totals as the statistics store them', async () => {
    for (const w of ['a', 'b', 'c', 'd']) await seedPlayer(prisma, w);
    await stats('a', 1, 100);
    await stats('b', 2, 900);
    await stats('c', 1, 500);
    await stats('d', 0, 9999);
    const top = await dir.topRiders(2);
    expect(top.map((r) => r.wallet)).toEqual(['b', 'c']);
    expect(top[0]!.totals).toMatchObject({ rides: 2, ridesFree: 2, metres: 900, donationLamports: 0 });
  });

  it('ties are broken the same way every time: players by wallet, pools by id (newest first), holders by wallet, riders by wallet', async () => {
    for (const w of ['b', 'a', 'c']) await seedPlayer(prisma, w);   // same createdAt
    expect((await dir.players(undefined, 10)).map((r) => r.wallet)).toEqual(['a', 'b', 'c']);
    await pools.upsert(aPool({ id: 1, createdAt: at(0) }, at(0)));
    await pools.upsert(aPool({ id: 2, createdAt: at(0) }, at(0)));
    expect((await dir.pools(10)).map((r) => r.id)).toEqual([2, 1]);
    for (const w of ['b', 'a']) await prisma.rideTicket.create({ data: { wallet: w, poolId: 1, balance: 1, bought: 2 } });
    expect((await dir.pool(1))?.holders.map((h) => h.wallet)).toEqual(['a', 'b']);
    await stats('b', 1, 100);
    await stats('a', 1, 100);
    expect((await dir.topRiders(10)).map((r) => r.wallet)).toEqual(['a', 'b']);
  });

  it('sessions: one row per wallet inside the window with the newest sign-in, the count and the newest ip / browser; newest first; the limit marks `truncated`', async () => {
    for (const w of ['a', 'b', 'c']) await seedPlayer(prisma, w);
    const signIn = (wallet: string, t: number, ip: string | null = null, userAgent: string | null = null) => prisma.signIn.create({ data: { wallet, at: at(t), ip, userAgent } });
    await signIn('a', -1000, '9.9.9.9');           // before the window
    await signIn('a', 10, '1.1.1.1', 'Safari');
    await signIn('a', 30, '2.2.2.2', 'Chrome');
    await signIn('b', 20, null, null);
    await signIn('b', 20, '3.3.3.3', 'Firefox');   // same instant: the later row wins
    await signIn('c', -5000);                      // only before the window
    const d = await dir.sessions(at(0), 10);
    expect(d.truncated).toBe(false);
    expect(d.rows).toEqual([
      { wallet: 'a', lastAt: at(30).getTime(), signIns: 2, ip: '2.2.2.2', userAgent: 'Chrome' },
      { wallet: 'b', lastAt: at(20).getTime(), signIns: 2, ip: '3.3.3.3', userAgent: 'Firefox' },
    ]);
    const one = await dir.sessions(at(0), 1);
    expect(one.rows.map((r) => r.wallet)).toEqual(['a']);
    expect(one.truncated).toBe(true);
    expect((await dir.sessions(at(40), 10)).rows).toEqual([]);
  });

  it('players: the last sign-in and the ticket sum come from aggregates over just the listed wallets (many sign-ins, many pools)', async () => {
    for (const w of ['a', 'b']) await seedPlayer(prisma, w);
    for (let i = 0; i < 5; i++) { await prisma.signIn.create({ data: { wallet: 'a', at: at(i * 10) } }); await pools.upsert(aPool({ id: 10 + i }, at(0))); await prisma.rideTicket.create({ data: { wallet: 'a', poolId: 10 + i, balance: i, bought: i } }); }
    await prisma.signIn.create({ data: { wallet: 'b', at: at(500) } });
    const rows = await dir.players(undefined, 10);
    expect(rows.find((r) => r.wallet === 'a')).toMatchObject({ lastSignInAt: at(40).getTime(), tickets: 10 });
    expect(rows.find((r) => r.wallet === 'b')).toMatchObject({ lastSignInAt: at(500).getTime(), tickets: 0 });
    expect(await dir.players('zzz', 10)).toEqual([]);
  });
});
