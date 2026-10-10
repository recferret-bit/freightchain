import { PoolPayoutPrismaRepository } from '../../../src/infrastructure/prisma/repositories/pool-payout.prisma.repository.js';
import { PoolPrismaRepository } from '../../../src/infrastructure/prisma/repositories/pool.prisma.repository.js';
import type { PrismaService } from '../../../src/infrastructure/prisma/prisma.service.js';
import { T0, at, testPrisma, wipe } from '../../support/db.js';
import { aPool } from '../../support/pools.js';

describe('PoolPayoutPrismaRepository (PostgreSQL)', () => {
  let prisma: PrismaService, repo: PoolPayoutPrismaRepository;
  beforeAll(async () => { prisma = await testPrisma(); repo = new PoolPayoutPrismaRepository(prisma); });
  afterAll(() => prisma.$disconnect());
  beforeEach(async () => { await wipe(prisma); await new PoolPrismaRepository(prisma).upsert(aPool({ id: 1, status: 'active' }, T0)); });

  const plan = () => repo.plan([
    { poolId: 1, rank: 1, wallet: 'alice', lamports: 3_000_000_000, status: 'planned' },
    { poolId: 1, rank: 2, wallet: 'bob', lamports: 100, status: 'paid' },
  ], at(0));

  it('the plan is written once: a second plan, or a row whose rank OR wallet is taken, changes nothing; lamports above 2^31 survive', async () => {
    await plan();
    await repo.plan([{ poolId: 1, rank: 1, wallet: 'mallory', lamports: 1, status: 'planned' }, { poolId: 1, rank: 3, wallet: 'alice', lamports: 1, status: 'planned' }], at(5));
    const rows = await repo.listByPool(1);
    expect(rows.map((r) => [r.rank, r.wallet, r.lamports, r.status, r.attempts])).toEqual([[1, 'alice', 3_000_000_000, 'planned', 0], [2, 'bob', 100, 'paid', 0]]);
    expect(rows[0]).toMatchObject({ signature: null, lastValidBlockHeight: null, error: null, createdAt: at(0), updatedAt: at(0) });
    expect(await repo.listByPool(2)).toEqual([]);
  });

  it('planned → sent (claimed once) → paid; a second claim and a paid with another signature lose', async () => {
    await plan();
    expect(await repo.claimSent(1, 1, 'SigA', 500, at(1))).toBe(true);
    expect(await repo.claimSent(1, 1, 'SigB', 501, at(2))).toBe(false);
    expect(await repo.markPaid(1, 1, 'SigB', at(3))).toBe(false);
    expect(await repo.markPaid(1, 1, 'SigA', at(3))).toBe(true);
    expect((await repo.listByPool(1))[0]).toMatchObject({ status: 'paid', signature: 'SigA', lastValidBlockHeight: 500, attempts: 1, updatedAt: at(3) });
  });

  it('release: sent → planned again (signature cleared, the reason kept); markPaidElsewhere only from planned; noteError keeps the status', async () => {
    await plan();
    await repo.claimSent(1, 1, 'SigA', 500, at(1));
    expect(await repo.release(1, 1, 'SigX', 'nope', at(2))).toBe(false);
    expect(await repo.release(1, 1, 'SigA', 'expired', at(2))).toBe(true);
    expect((await repo.listByPool(1))[0]).toMatchObject({ status: 'planned', signature: null, lastValidBlockHeight: null, error: 'expired' });
    await repo.noteError(1, 1, 'x'.repeat(600), at(3));
    expect((await repo.listByPool(1))[0]?.error).toHaveLength(500);
    expect(await repo.markPaidElsewhere(1, 1, at(4))).toBe(true);
    expect(await repo.markPaidElsewhere(1, 1, at(4))).toBe(false);
    expect((await repo.listByPool(1))[0]).toMatchObject({ status: 'paid', error: 'paid outside the payout job' });
  });

  it('a signature is unique across the ledger', async () => {
    await plan();
    await repo.plan([{ poolId: 1, rank: 3, wallet: 'carol', lamports: 1, status: 'planned' }], at(0));
    await repo.claimSent(1, 1, 'Same', 1, at(1));
    await expect(repo.claimSent(1, 3, 'Same', 1, at(1))).rejects.toThrow();
  });
});
