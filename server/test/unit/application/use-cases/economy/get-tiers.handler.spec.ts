import { GetTiersHandler } from '../../../../../src/application/use-cases/economy/get-tiers/get-tiers.handler.js';
import { TREASURY } from '../../../../support/fake-chain.js';
import { StubPrice } from '../../../../support/stub-price.js';
import { FixedRules, unitRules } from '../../../../support/unit-context.js';

describe('GetTiersHandler', () => {
  it('every tier with its live lamport price, shift length and minimum distance', async () => {
    const dto = await new GetTiersHandler(new FixedRules(), new StubPrice(100)).execute();
    expect(dto.solUsd).toBe(100);
    expect(dto.treasury).toBe(TREASURY);
    expect(dto.tiers).toEqual([
      { id: 'free', usd: 0, seconds: 10, completeDist: 140, lamports: null, available: true },
      { id: '1h', usd: 5, seconds: 3600, completeDist: 50_400, lamports: 50_000_000, available: true },
      { id: '4h', usd: 15, seconds: 14_400, completeDist: 201_600, lamports: 150_000_000, available: true },
      { id: '8h', usd: 50, seconds: 28_800, completeDist: 403_200, lamports: 500_000_000, available: true },
    ]);
  });

  it('paid tiers are unavailable without a price or without a treasury – the free one never is', async () => {
    const noPrice = await new GetTiersHandler(new FixedRules(), new StubPrice(null)).execute();
    expect(noPrice.solUsd).toBeNull();
    expect(noPrice.tiers.map((t) => t.available)).toEqual([true, false, false, false]);
    const noTreasury = await new GetTiersHandler(new FixedRules(unitRules({ treasury: '' })), new StubPrice()).execute();
    expect(noTreasury.treasury).toBeNull();
    expect(noTreasury.tiers.map((t) => t.available)).toEqual([true, false, false, false]);
  });
});
