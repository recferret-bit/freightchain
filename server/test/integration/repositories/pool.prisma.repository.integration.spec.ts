import { PoolPrismaRepository } from '../../../src/infrastructure/prisma/repositories/pool.prisma.repository.js';
import type { PrismaService } from '../../../src/infrastructure/prisma/prisma.service.js';
import { T0, at, inTx, sleep, testPrisma, wipe } from '../../support/db.js';
import { aPool, poolProps } from '../../support/pools.js';

const DAY = 86_400;

describe('PoolPrismaRepository (PostgreSQL)', () => {
  let prisma: PrismaService, repo: PoolPrismaRepository;
  beforeAll(async () => { prisma = await testPrisma(); repo = new PoolPrismaRepository(prisma); });
  afterAll(() => prisma.$disconnect());
  beforeEach(() => wipe(prisma));

  it('upsert inserts then overwrites; findById maps every field back (lamports above 2^31 included)', async () => {
    const big = poolProps({ id: 7, priceLamports: 3_000_000_000, vaultLamports: 9_000_000_000, sponsored: 2_500_000_000, ticketsSold: 3, buyers: 2 }, T0);
    await repo.upsert(aPool(big, T0));
    expect((await repo.findById(7))?.snapshot()).toEqual(big);
    await repo.upsert(aPool({ ...big, status: 'active', ticketsSold: 4, syncedAt: at(60) }, T0));
    expect((await repo.findById(7))?.snapshot()).toMatchObject({ status: 'active', ticketsSold: 4, syncedAt: at(60) });
    expect(await repo.findById(8)).toBeNull();
    expect((await repo.findByAddress(big.address))?.id).toBe(7);
    expect(await repo.findByAddress('nope')).toBeNull();
  });

  it('the ride seed is written with the row and never again: a later upsert (a re-sync, two first syncs racing) cannot move the pool\'s riders to another road', async () => {
    await repo.upsert(aPool({ id: 3, rideSeed: 2_147_483_647 }, T0));
    await repo.upsert(aPool({ id: 3, rideSeed: 11, status: 'active' }, T0));
    expect((await repo.findById(3))?.snapshot()).toMatchObject({ rideSeed: 2_147_483_647, status: 'active' });
  });

  it('listLive / listLiveOfTier: only open + active, soonest play deadline first; findMany by id', async () => {
    await repo.upsert(aPool({ id: 1, status: 'active', playDeadline: at(10 * DAY) }, T0));
    await repo.upsert(aPool({ id: 2, status: 'open', playDeadline: at(5 * DAY) }, T0));
    await repo.upsert(aPool({ id: 3, status: 'refunding' }, T0));
    await repo.upsert(aPool({ id: 4, status: 'open', tier: '4h', playDeadline: at(1 * DAY) }, T0));
    await repo.upsert(aPool({ id: 5, status: 'settled' }, T0));
    expect((await repo.listLive()).map((p) => p.id)).toEqual([4, 2, 1]);
    expect((await repo.listLiveOfTier('1h')).map((p) => p.id)).toEqual([2, 1]);
    expect(await repo.listLiveOfTier('8h')).toEqual([]);
    expect((await repo.findMany([5, 1, 99])).map((p) => p.id)).toEqual([1, 5]);
    expect(await repo.findMany([])).toEqual([]);
  });

  it('listOpenPastDeadline: open pools whose preparation period is over', async () => {
    await repo.upsert(aPool({ id: 1, prepDeadline: at(100) }, T0));
    await repo.upsert(aPool({ id: 2, prepDeadline: at(50) }, T0));
    await repo.upsert(aPool({ id: 3, prepDeadline: at(500) }, T0));
    await repo.upsert(aPool({ id: 4, status: 'active', prepDeadline: at(10) }, T0));
    expect((await repo.listOpenPastDeadline(at(100))).map((p) => p.id)).toEqual([2, 1]);
  });

  it('findByIdForUpdate holds the row until the transaction ends', async () => {
    await repo.upsert(aPool({ id: 1 }, T0));
    const order: string[] = [];
    let release!: () => void;
    const held = new Promise<void>((r) => { release = r; });
    const first = inTx(prisma, async (tx) => { await repo.findByIdForUpdate(1, tx); order.push('a locked'); await held; order.push('a done'); });
    await sleep(100);
    const second = inTx(prisma, async (tx) => { await repo.findByIdForUpdate(1, tx); order.push('b locked'); });
    await sleep(150);
    release();
    await Promise.all([first, second]);
    expect(order).toEqual(['a locked', 'a done', 'b locked']);
    expect(await inTx(prisma, (tx) => repo.findByIdForUpdate(99, tx))).toBeNull();
  });

  it('the payout state and the admin\'s hold are the server\'s own: written on insert and through savePayout / saveHold only – a later upsert never erases them', async () => {
    await repo.upsert(aPool({ id: 4, status: 'active', payoutState: 'pending' }, T0));
    await repo.saveHold(4, { by: 'Admin', at: at(10), note: 'rank 2' });
    await repo.savePayout(4, 'held', 'rank 2');
    await repo.upsert(aPool({ id: 4, status: 'active', ticketsSold: 9, payoutState: 'pending', hold: null }, T0)); // a sync holding a stale copy
    expect((await repo.findById(4))?.snapshot()).toMatchObject({ ticketsSold: 9, payoutState: 'held', payoutNote: 'rank 2', hold: { by: 'Admin', at: at(10), note: 'rank 2' } });
    await repo.saveHold(4, null);
    expect((await repo.findById(4))?.hold).toBeNull();
  });

  it('listPayable: active pools whose payout time has come, oldest first; listSettled: the newest settled first', async () => {
    await repo.upsert(aPool({ id: 1, status: 'active', playDeadline: at(1 * DAY), payoutAt: at(3 * DAY) }, T0));
    await repo.upsert(aPool({ id: 2, status: 'active', playDeadline: at(1 * DAY), payoutAt: at(2 * DAY) }, T0));
    await repo.upsert(aPool({ id: 3, status: 'active', playDeadline: at(1 * DAY), payoutAt: at(9 * DAY) }, T0));
    await repo.upsert(aPool({ id: 4, status: 'open', playDeadline: at(1 * DAY), payoutAt: at(1 * DAY) }, T0));
    await repo.upsert(aPool({ id: 5, status: 'settled', playDeadline: at(1 * DAY), payoutAt: at(1 * DAY) }, T0));
    await repo.upsert(aPool({ id: 6, status: 'settled', playDeadline: at(1 * DAY), payoutAt: at(2 * DAY) }, T0));
    expect((await repo.listPayable(at(3 * DAY))).map((p) => p.id)).toEqual([2, 1]);
    expect((await repo.listSettled(5)).map((p) => p.id)).toEqual([6, 5]);
    expect((await repo.listSettled(1)).map((p) => p.id)).toEqual([6]);
  });
});
