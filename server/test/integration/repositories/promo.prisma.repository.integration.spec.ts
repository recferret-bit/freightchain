import { PromoPrismaRepository } from '../../../src/infrastructure/prisma/repositories/promo.prisma.repository.js';
import type { PrismaService } from '../../../src/infrastructure/prisma/prisma.service.js';
import { PromoCode } from '../../../src/domain/economy/promo-code.entity.js';
import { T0, at, inTx, testPrisma, wipe } from '../../support/db.js';

const promo = (code: string, over: Partial<Parameters<typeof PromoCode.create>[0]> = {}) =>
  PromoCode.create({ code, poolId: null, tier: '1h', credits: 2, maxRedemptions: 2, perWallet: 1, expiresAt: at(1000), note: null, now: T0, ...over });

describe('PromoPrismaRepository (PostgreSQL)', () => {
  let prisma: PrismaService, repo: PromoPrismaRepository;
  beforeAll(async () => { prisma = await testPrisma(); repo = new PromoPrismaRepository(prisma); });
  afterAll(() => prisma.$disconnect());
  beforeEach(() => wipe(prisma));

  it('insert once (a duplicate code is false), findByCode maps back, list newest first', async () => {
    expect(await repo.insert(promo('HELLO'))).toBe(true);
    expect(await repo.insert(promo('HELLO', { credits: 9 }))).toBe(false);
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
});
