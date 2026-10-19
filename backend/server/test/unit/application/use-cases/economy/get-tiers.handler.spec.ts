import { GetTiersHandler } from '../../../../../src/application/use-cases/economy/get-tiers/get-tiers.handler.js';
import { TREASURY } from '../../../../support/fake-chain.js';
import { StubPrice } from '../../../../support/stub-price.js';
import { FixedRules, unitRules } from '../../../../support/unit-context.js';
import { FakeClock } from '../../../../support/fake-clock.js';
import { MemoryDb } from '../../../../support/in-memory/memory-db.js';
import { MemoryPoolRepository } from '../../../../support/in-memory/memory-ledger-repositories.js';
import { aPool } from '../../../../support/pools.js';
import { setTierOnSaleForTest } from '../../../../../src/domain/rides/ride-tier.js';

describe('GetTiersHandler', () => {
  beforeEach(() => setTierOnSaleForTest('1h', false));

  it('every tier with its shift length and minimum distance; a lamport price only when the shift is on sale or has a pool', async () => {
    const dto = await new GetTiersHandler(new FixedRules(), new StubPrice(100), new MemoryPoolRepository(new MemoryDb()), new FakeClock()).execute();
    expect(dto.solUsd).toBe(100);
    expect(dto.treasury).toBe(TREASURY);
    expect(dto.paymentMode).toBe('transfer');
    expect(dto.tiers).toEqual([
      {
        id: 'free', usd: 0, seconds: 10, completeDist: 84, lamports: null, available: true, onSale: true, schedule: null, pool: null,
        levels: [   // FREE_RIDE_SECONDS (10 here) × 1 / 5⁄3 / 5, whole seconds, each at its own K
          { level: 1, trip: 'free-1c', name: 'EASY', seconds: 10, completeDist: 0.3 * 28 * 10, tutorial: true, assist: true },
          { level: 2, trip: 'free-2c', name: 'MEDIUM', seconds: 17, completeDist: 0.4 * 28 * 17, tutorial: true, assist: true },
          { level: 3, trip: 'free-3c', name: 'HARD', seconds: 100, completeDist: 0.4 * 28 * 100, tutorial: false, assist: false },
        ],
      },
      { id: '1h', usd: 5, seconds: 3600, completeDist: 50_400, lamports: null, available: false, onSale: false, schedule: { saleHours: 24, playHours: 3, reviewHours: 48 }, pool: null },
      { id: '4h', usd: 15, seconds: 14_400, completeDist: 201_600, lamports: null, available: false, onSale: false, schedule: null, pool: null },
      { id: '8h', usd: 50, seconds: 28_800, completeDist: 403_200, lamports: null, available: false, onSale: false, schedule: null, pool: null },
    ]);
  });

  it('paid tiers are unavailable without a price or without a treasury – the free one never is', async () => {
    const noPrice = await new GetTiersHandler(new FixedRules(), new StubPrice(null), new MemoryPoolRepository(new MemoryDb()), new FakeClock()).execute();
    expect(noPrice.solUsd).toBeNull();
    expect(noPrice.tiers.map((t) => t.available)).toEqual([true, false, false, false]);
    const noTreasury = await new GetTiersHandler(new FixedRules(unitRules({ treasury: '' })), new StubPrice(), new MemoryPoolRepository(new MemoryDb()), new FakeClock()).execute();
    expect(noTreasury.treasury).toBeNull();
    expect(noTreasury.tiers.map((t) => t.available)).toEqual([true, false, false, false]);
  });

  it('a tier with a registered pool is priced and sold by it: the pool still selling first, else the first live one shown as unavailable', async () => {
    const db = new MemoryDb(), pools = new MemoryPoolRepository(db), clock = new FakeClock();
    await pools.upsert(aPool({ id: 1, tier: '1h', status: 'active', priceLamports: 20_000_000 }));
    await pools.upsert(aPool({ id: 2, tier: '4h', status: 'open', prepDeadline: new Date(clock.ms - 1) })); // preparation over: not buyable
    const dto = await new GetTiersHandler(new FixedRules(unitRules({ treasury: '' })), new StubPrice(null), pools, clock).execute();
    const [, h1, h4, h8] = dto.tiers;
    expect(h1).toMatchObject({ lamports: 20_000_000, available: true, onSale: false, pool: { id: 1, status: 'active' } });
    expect(h4).toMatchObject({ available: false, onSale: false, pool: { id: 2 } }); // a registered pool is still shown
    expect(h8).toMatchObject({ lamports: null, available: false, onSale: false, pool: null });
  });

  it('program mode is ticket-only: a paid tier with no live pool is not on sale (no legacy pay-per-ride price), the free one still is', async () => {
    const db = new MemoryDb(), pools = new MemoryPoolRepository(db), clock = new FakeClock();
    await pools.upsert(aPool({ id: 1, tier: '1h', status: 'active', priceLamports: 20_000_000 }));
    await pools.upsert(aPool({ id: 2, tier: '4h', status: 'refunding' })); // failed: not live
    const dto = await new GetTiersHandler(new FixedRules(unitRules({ paymentMode: 'program' })), new StubPrice(100), pools, clock).execute();
    expect(dto.paymentMode).toBe('program');
    expect(dto.tiers.map((t) => [t.id, t.available, t.lamports, t.pool?.id ?? null, t.onSale])).toEqual([
      ['free', true, null, null, true], ['1h', true, 20_000_000, 1, false], ['4h', false, null, null, false], ['8h', false, null, null, false],
    ]);
  });
});
