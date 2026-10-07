import { ChainEventPrismaRepository } from '../../../src/infrastructure/prisma/repositories/chain-event.prisma.repository.js';
import type { ChainEventRow } from '../../../src/domain/economy/chain-events.js';
import type { PrismaService } from '../../../src/infrastructure/prisma/prisma.service.js';
import { at, inTx, testPrisma, wipe } from '../../support/db.js';

const row = (over: Partial<ChainEventRow> = {}): ChainEventRow => ({
  signature: 'sigA', index: 0, kind: 'TicketBought', poolId: 7, wallet: 'w1', orderId: '0b5ec9e3-1f2a-4c3d-8e4f-5a6b7c8d9e0f', lamports: 9_007_199_254_740_991,
  outcome: 'settled', detail: null, at: at(0), finalizedAt: null, lastValidBlockHeight: 123_456_789_012, ...over,
});

describe('ChainEventPrismaRepository (PostgreSQL)', () => {
  let prisma: PrismaService, repo: ChainEventPrismaRepository;
  beforeAll(async () => { prisma = await testPrisma(); repo = new ChainEventPrismaRepository(prisma); });
  afterAll(() => prisma.$disconnect());
  beforeEach(() => wipe(prisma));

  it('records and finds a row exactly (BigInt lamports / heights ⇄ numbers, nulls kept)', async () => {
    expect(await repo.record(row())).toBe(true);
    expect(await repo.find('sigA', 0)).toEqual(row());
    expect(await repo.record(row({ index: 1, kind: 'PoolActivated', wallet: null, orderId: null, lamports: null, lastValidBlockHeight: null, outcome: 'applied' }))).toBe(true);
    expect(await repo.find('sigA', 1)).toMatchObject({ kind: 'PoolActivated', lamports: null, lastValidBlockHeight: null });
    expect(await repo.find('sigA', 2)).toBeNull();
  });

  it('(signature, index) is unique: a duplicate is skipped – false, the first row kept', async () => {
    await repo.record(row());
    expect(await repo.record(row({ outcome: 'unmatched', detail: 'again' }))).toBe(false);
    expect(await repo.find('sigA', 0)).toMatchObject({ outcome: 'settled', detail: null });
  });

  it('a duplicate inside a transaction does NOT abort it (no unique violation): later writes in the same transaction commit', async () => {
    await repo.record(row());
    await inTx(prisma, async (tx) => {
      expect(await repo.record(row(), tx)).toBe(false);
      expect(await repo.record(row({ index: 5 }), tx)).toBe(true);
    });
    expect(await repo.find('sigA', 5)).not.toBeNull();
  });

  it('recentOfPool: newest first, only that pool, limited', async () => {
    await repo.record(row({ signature: 's1', at: at(1) }));
    await repo.record(row({ signature: 's2', at: at(2) }));
    await repo.record(row({ signature: 's2', index: 1, at: at(2), kind: 'PoolActivated' }));
    await repo.record(row({ signature: 's3', at: at(3), poolId: 8 }));
    expect((await repo.recentOfPool(7, 10)).map((e) => `${e.signature}#${e.index}`)).toEqual(['s2#1', 's2#0', 's1#0']);
    expect((await repo.recentOfPool(7, 1)).map((e) => e.signature)).toEqual(['s2']);
  });

  it('the finality pass: settled/applied without finalizedAt, oldest first; markFinalized stamps a whole transaction once', async () => {
    await repo.record(row({ signature: 's2', at: at(2) }));
    await repo.record(row({ signature: 's1', at: at(1), outcome: 'applied' }));
    await repo.record(row({ signature: 's1', index: 1, at: at(1), outcome: 'applied' }));
    await repo.record(row({ signature: 's3', at: at(3), outcome: 'invalid' }));
    await repo.record(row({ signature: 's4', at: at(4), finalizedAt: at(5) }));
    expect((await repo.listUnfinalized(10)).map((e) => `${e.signature}#${e.index}`)).toEqual(['s1#0', 's1#1', 's2#0']);
    expect((await repo.listUnfinalized(1)).length).toBe(1);
    await repo.markFinalized('s1', at(9));
    await repo.markFinalized('s4', at(9)); // already final: keeps its stamp
    expect((await repo.find('s1', 1))?.finalizedAt).toEqual(at(9));
    expect((await repo.find('s4', 0))?.finalizedAt).toEqual(at(5));
    expect((await repo.listUnfinalized(10)).map((e) => e.signature)).toEqual(['s2']);
  });

  it('markDropped turns every event of the transaction into dropped, with the reason', async () => {
    await repo.record(row({ signature: 's1' }));
    await repo.record(row({ signature: 's1', index: 1, kind: 'PoolActivated' }));
    await repo.record(row({ signature: 's2' }));
    await repo.markDropped('s1', 'expired at height 250');
    expect(await repo.find('s1', 1)).toMatchObject({ outcome: 'dropped', detail: 'expired at height 250' });
    expect((await repo.find('s2', 0))?.outcome).toBe('settled');
    expect((await repo.listUnfinalized(10)).map((e) => e.signature)).toEqual(['s2']);
  });
});
