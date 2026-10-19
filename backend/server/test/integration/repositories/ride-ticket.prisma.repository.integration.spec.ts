import { RideTicketPrismaRepository } from '../../../src/infrastructure/prisma/repositories/ride-ticket.prisma.repository.js';
import { PoolPrismaRepository } from '../../../src/infrastructure/prisma/repositories/pool.prisma.repository.js';
import type { PrismaService } from '../../../src/infrastructure/prisma/prisma.service.js';
import { VersionConflictError } from '../../../src/domain/shared/errors.js';
import { T0, at, inTx, seedPlayer, testPrisma, wipe } from '../../support/db.js';
import { aPool } from '../../support/pools.js';

describe('RideTicketPrismaRepository (PostgreSQL)', () => {
  let prisma: PrismaService, repo: RideTicketPrismaRepository;
  beforeAll(async () => { prisma = await testPrisma(); repo = new RideTicketPrismaRepository(prisma); });
  afterAll(() => prisma.$disconnect());
  beforeEach(async () => {
    await wipe(prisma);
    for (const w of ['a', 'b', 'c']) await seedPlayer(prisma, w);
    const pools = new PoolPrismaRepository(prisma);
    for (const id of [1, 2]) await pools.upsert(aPool({ id }, T0));
  });

  it('open creates the row once (a second open is not an error) and returns the stored one', async () => {
    expect((await repo.open('a', 1)).snapshot()).toEqual({ wallet: 'a', poolId: 1, balance: 0, bought: 0, version: 1 });
    const t = await repo.open('a', 1);
    t.recordPurchase(2);
    await repo.save(t);
    expect((await repo.open('a', 1)).snapshot()).toMatchObject({ balance: 2, bought: 2, version: 2 });
    expect(await repo.find('a', 2)).toBeNull();
  });

  it('save bumps the version; a stale entity is a VersionConflictError', async () => {
    await repo.open('a', 1);
    const one = (await repo.find('a', 1))!, stale = (await repo.find('a', 1))!;
    one.grant(3, 5);
    expect((await repo.save(one)).version).toBe(2);
    stale.grant(1, 5);
    await expect(repo.save(stale)).rejects.toBeInstanceOf(VersionConflictError);
    expect((await repo.find('a', 1))?.balance).toBe(3);
  });

  it('listByWallet by pool; recentGrants newest first with a limit', async () => {
    await repo.open('a', 2); await repo.open('a', 1); await repo.open('b', 1);
    expect((await repo.listByWallet('a')).map((t) => t.poolId)).toEqual([1, 2]);
    await repo.appendGrant({ wallet: 'a', poolId: 1, delta: 2, source: 'payment', ref: 'sig1', at: at(1) });
    await repo.appendGrant({ wallet: 'a', poolId: 1, delta: -1, source: 'spend', ref: 'ride1', at: at(3) });
    await repo.appendGrant({ wallet: 'a', poolId: 2, delta: 1, source: 'promo', ref: 'HELLO', at: at(2) });
    await repo.appendGrant({ wallet: 'b', poolId: 1, delta: 1, source: 'admin', ref: null, at: at(4) });
    expect(await repo.recentGrants('a', 2)).toEqual([
      { wallet: 'a', poolId: 1, delta: -1, source: 'spend', ref: 'ride1', at: at(3) },
      { wallet: 'a', poolId: 2, delta: 1, source: 'promo', ref: 'HELLO', at: at(2) },
    ]);
  });

  it('voidAllOfPool zeroes every non-empty ticket of the pool, bumps versions, writes one void line each and leaves other pools alone', async () => {
    for (const [w, pool, n] of [['a', 1, 3], ['b', 1, 1], ['c', 1, 0], ['a', 2, 2]] as const) {
      const t = await repo.open(w, pool);
      if (n) { t.recordPurchase(n); await repo.save(t); }
    }
    const stale = (await repo.find('a', 1))!;
    expect(await inTx(prisma, (tx) => repo.voidAllOfPool(1, at(9), tx))).toBe(4);
    expect((await repo.find('a', 1))?.snapshot()).toMatchObject({ balance: 0, bought: 3, version: 3 });
    expect((await repo.find('c', 1))?.snapshot()).toMatchObject({ balance: 0, version: 1 });
    expect((await repo.find('a', 2))?.balance).toBe(2);
    expect(await repo.recentGrants('a', 5)).toEqual([{ wallet: 'a', poolId: 1, delta: -3, source: 'void', ref: 'pool 1', at: at(9) }]);
    expect(await repo.recentGrants('c', 5)).toEqual([]);
    stale.spend(); // a spend that read the row before the void must not resurrect the ticket
    await expect(repo.save(stale)).rejects.toBeInstanceOf(VersionConflictError);
    expect(await inTx(prisma, (tx) => repo.voidAllOfPool(1, at(10), tx))).toBe(0);
  });
});
