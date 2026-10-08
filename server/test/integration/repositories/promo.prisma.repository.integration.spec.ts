import { PromoPrismaRepository } from '../../../src/infrastructure/prisma/repositories/promo.prisma.repository.js';
import type { PrismaService } from '../../../src/infrastructure/prisma/prisma.service.js';
import type { PromoCreateInput } from '../../../src/domain/economy/promo.types.js';
import { T0, at, inTx, testPrisma, wipe } from '../../support/db.js';
import { aPromo, ticketEffect } from '../../support/promos.js';

const promo = (code: string, over: Partial<PromoCreateInput> & { now?: Date } = {}) => {
  const { now = T0, ...input } = over;
  return aPromo(now, { code, maxRedemptions: 2, expiresAt: at(1000), ...input });
};

describe('PromoPrismaRepository (PostgreSQL)', () => {
  let prisma: PrismaService, repo: PromoPrismaRepository;
  beforeAll(async () => { prisma = await testPrisma(); repo = new PromoPrismaRepository(prisma); });
  afterAll(() => prisma.$disconnect());
  beforeEach(() => wipe(prisma));

  it('insert once (a duplicate code is false), findByCode maps back, list newest first', async () => {
    expect(await repo.insert(promo('HELLO'))).toBe(true);
    expect(await repo.insert(promo('HELLO', { effect: ticketEffect({ credits: 9 }) }))).toBe(false);
    expect((await repo.findByCode('HELLO'))?.snapshot()).toEqual(promo('HELLO').snapshot());
    await repo.insert(promo('LATER', { now: at(5) }));
    expect((await repo.list()).map((p) => p.code)).toEqual(['LATER', 'HELLO']);
    expect(await repo.findByCode('NOPE')).toBeNull();
  });

  it('disable stamps once; unknown code is false', async () => {
    await repo.insert(promo('HELLO'));
    expect(await repo.disable('HELLO', at(1))).toBe(true);
    expect(await repo.disable('HELLO', at(2))).toBe(true);
    expect((await repo.findByCode('HELLO'))?.snapshot().disabledAt).toEqual(at(1));
    expect(await repo.disable('NOPE', at(1))).toBe(false);
  });

  it('takeRedemption: below the maximum only, never when disabled or expired; unlimited codes never run out', async () => {
    await repo.insert(promo('TWO'));
    await repo.insert(promo('FREE', { maxRedemptions: null, expiresAt: null }));
    await repo.insert(promo('GONE'));
    await repo.disable('GONE', at(1));
    const take = (code: string, when = at(10)) => inTx(prisma, (tx) => repo.takeRedemption(code, when, tx));
    expect([await take('TWO'), await take('TWO'), await take('TWO')]).toEqual([true, true, false]);
    expect(await take('TWO', at(1000))).toBe(false);
    expect(await take('GONE')).toBe(false);
    for (let i = 0; i < 5; i++) expect(await take('FREE')).toBe(true);
    expect((await repo.findByCode('FREE'))?.snapshot().redeemed).toBe(5);
  });

  it('the last redemption goes to exactly one of many concurrent takers', async () => {
    await repo.insert(promo('LAST', { maxRedemptions: 1 }));
    const got = await Promise.all(Array.from({ length: 8 }, () => inTx(prisma, (tx) => repo.takeRedemption('LAST', at(10), tx))));
    expect(got.filter(Boolean)).toHaveLength(1);
    expect((await repo.findByCode('LAST'))?.snapshot().redeemed).toBe(1);
  });

  it('insertRedemption: (code, wallet, n) is unique – the per-wallet limit; countRedemptions per wallet', async () => {
    await repo.insert(promo('HELLO', { perWallet: 2 }));
    expect(await inTx(prisma, (tx) => repo.insertRedemption('HELLO', 'a', 1, at(1), tx))).toBe(true);
    expect(await inTx(prisma, (tx) => repo.insertRedemption('HELLO', 'a', 1, at(2), tx))).toBe(false);
    expect(await inTx(prisma, (tx) => repo.insertRedemption('HELLO', 'a', 2, at(3), tx))).toBe(true);
    expect(await inTx(prisma, (tx) => repo.insertRedemption('HELLO', 'b', 1, at(3), tx))).toBe(true);
    expect(await repo.countRedemptions('HELLO', 'a')).toBe(2);
    expect(await repo.countRedemptions('HELLO', 'c')).toBe(0);
  });

  it('every effect kind and the new fields round-trip: free rides, a cosmetic, a pinned pool, description, start', async () => {
    await repo.insert(promo('RIDES', { effect: { kind: 'free_rides', count: 3 }, description: 'Three rides', startsAt: at(5) }));
    await repo.insert(promo('WHEEL', { effect: { kind: 'cosmetic', slot: 'cabin', item: 'noir' } }));
    await repo.insert(promo('PIN', { effect: ticketEffect({ tier: '4h', poolId: 7, credits: 3 }), note: 'private' }));
    for (const code of ['RIDES', 'WHEEL', 'PIN']) expect((await repo.findByCode(code))?.snapshot(), code).toEqual(promo(code, code === 'RIDES' ? { effect: { kind: 'free_rides', count: 3 }, description: 'Three rides', startsAt: at(5) } : code === 'WHEEL' ? { effect: { kind: 'cosmetic', slot: 'cabin', item: 'noir' } } : { effect: ticketEffect({ tier: '4h', poolId: 7, credits: 3 }), note: 'private' }).snapshot());
  });

  it('takeRedemption never before startsAt – and takes from that very instant', async () => {
    await repo.insert(promo('SOON', { startsAt: at(100), maxRedemptions: null }));
    const take = (when: Date) => inTx(prisma, (tx) => repo.takeRedemption('SOON', when, tx));
    expect(await take(at(99))).toBe(false);
    expect(await take(at(100))).toBe(true);
    expect((await repo.findByCode('SOON'))?.snapshot().redeemed).toBe(1);
  });

  it('rows written before this feature (kind defaulted, startsAt backfilled) read as ticket codes starting at their creation', async () => {
    await prisma.$executeRaw`INSERT INTO "economy"."PromoCode" ("code", "tier", "credits", "createdAt", "startsAt") VALUES ('OLD', '1h', 2, ${at(3)}, ${at(3)})`;
    expect((await repo.findByCode('OLD'))?.snapshot()).toMatchObject({ effect: { kind: 'tickets', tier: '1h', poolId: null, credits: 2 }, startsAt: at(3), description: null });
  });

  it('listRedemptions: newest first, narrowed by code and / or wallet, limited', async () => {
    await repo.insert(promo('AAA', { perWallet: 2 })); await repo.insert(promo('BBB'));
    for (const [code, wallet, n, t] of [['AAA', 'a', 1, 1], ['BBB', 'a', 1, 2], ['AAA', 'b', 1, 3], ['AAA', 'a', 2, 4]] as const) await inTx(prisma, (tx) => repo.insertRedemption(code, wallet, n, at(t), tx));
    const rows = (await repo.listRedemptions({ limit: 10 })).map((r) => `${r.code}/${r.wallet}/${r.n}`);
    expect(rows).toEqual(['AAA/a/2', 'AAA/b/1', 'BBB/a/1', 'AAA/a/1']);
    expect((await repo.listRedemptions({ code: 'AAA', limit: 10 })).map((r) => r.wallet)).toEqual(['a', 'b', 'a']);
    expect((await repo.listRedemptions({ wallet: 'a', limit: 10 })).map((r) => r.code)).toEqual(['AAA', 'BBB', 'AAA']);
    expect((await repo.listRedemptions({ code: 'BBB', wallet: 'b', limit: 10 }))).toEqual([]);
    expect(await repo.listRedemptions({ limit: 2 })).toHaveLength(2);
    expect((await repo.listRedemptions({ limit: 1 }))[0]).toEqual({ code: 'AAA', wallet: 'a', n: 2, at: at(4) });
  });
});
