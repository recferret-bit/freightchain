import { TicketOrderPrismaRepository } from '../../../src/infrastructure/prisma/repositories/ticket-order.prisma.repository.js';
import { PoolPrismaRepository } from '../../../src/infrastructure/prisma/repositories/pool.prisma.repository.js';
import type { PrismaService } from '../../../src/infrastructure/prisma/prisma.service.js';
import { TicketOrder } from '../../../src/domain/economy/ticket-order.entity.js';
import { T0, at, seedPlayer, testPrisma, wipe } from '../../support/db.js';
import { aPool } from '../../support/pools.js';

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

describe('TicketOrderPrismaRepository (PostgreSQL)', () => {
  let prisma: PrismaService, repo: TicketOrderPrismaRepository;
  const pool = aPool({ id: 1 }, T0);
  const order = (n: number, wallet = 'a', now = T0) => TicketOrder.create({ id: id(n), wallet, pool, qty: 2, walletBought: 0, now });
  beforeAll(async () => { prisma = await testPrisma(); repo = new TicketOrderPrismaRepository(prisma); });
  afterAll(() => prisma.$disconnect());
  beforeEach(async () => {
    await wipe(prisma);
    await seedPlayer(prisma, 'a'); await seedPlayer(prisma, 'b');
    await new PoolPrismaRepository(prisma).upsert(pool);
  });

  it('insert / findById / save map every field back (large block heights included)', async () => {
    const o = order(1);
    await repo.insert(o);
    expect((await repo.findById(id(1)))?.snapshot()).toEqual(o.snapshot());
    o.attachTransaction('bXNn', 312_000_000_123);
    o.markPaid('sig1', 0, at(5));
    await repo.save(o);
    expect((await repo.findById(id(1)))?.snapshot()).toEqual(o.snapshot());
    expect(await repo.findById(id(9))).toBeNull();
  });

  it('findBySettlement: (signature, eventIndex) is unique – a second order paid by the same event is refused', async () => {
    const o = order(1); o.markPaid('sig', 0, at(1)); await repo.insert(o);
    expect((await repo.findBySettlement('sig', 0))?.id).toBe(id(1));
    expect(await repo.findBySettlement('sig', 1)).toBeNull();
    const twin = TicketOrder.adopt({ id: id(2), wallet: 'b', poolId: 1, qty: 1, lamports: 50_000_000, signature: 'sig', eventIndex: 0, now: at(2) });
    await expect(repo.insert(twin)).rejects.toThrow();
    await repo.insert(TicketOrder.adopt({ id: id(3), wallet: 'b', poolId: 1, qty: 1, lamports: 50_000_000, signature: 'sig', eventIndex: 1, now: at(2) }));
  });

  it('findAwaitingByWallet = the newest unpaid one; listPaid oldest first; totalsOf counts paid only', async () => {
    await repo.insert(order(1, 'a', at(1))); await repo.insert(order(2, 'a', at(2))); await repo.insert(order(3, 'b', at(3)));
    expect((await repo.findAwaitingByWallet('a'))?.id).toBe(id(2));
    const p1 = (await repo.findById(id(1)))!; p1.markPaid('s1', 0, at(10)); await repo.save(p1);
    const p2 = (await repo.findById(id(2)))!; p2.markPaid('s2', 0, at(9)); await repo.save(p2);
    expect(await repo.findAwaitingByWallet('a')).toBeNull();
    expect((await repo.listPaid('a', 1)).map((o) => o.id)).toEqual([id(2), id(1)]);
    expect(await repo.totalsOf('a')).toEqual({ lamports: 200_000_000, tickets: 4 });
    p1.markRefunded(at(20)); await repo.save(p1);
    expect(await repo.totalsOf('a')).toEqual({ lamports: 100_000_000, tickets: 2 });
    expect(await repo.totalsOf('nobody')).toEqual({ lamports: 0, tickets: 0 });
  });
});
