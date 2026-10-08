import { poolPayouts } from '../../../src/domain/economy/pool-payouts.js';

const wallets = (n: number) => Array.from({ length: n }, (_, i) => `w${i + 1}`);
const sum = (xs: { lamports: number }[]) => xs.reduce((a, x) => a + x.lamports, 0);

describe('poolPayouts – the prize share by rank', () => {
  it('a 0.7 SOL prize and 20 riders: 25 / 15 / 10 parts to the top 3 plus an equal top-20 share each', () => {
    const p = poolPayouts(700_000_000, wallets(25));
    expect(p).toHaveLength(20);
    expect(p.slice(0, 4)).toEqual([
      { rank: 1, wallet: 'w1', lamports: 250_000_000 + 10_000_000 },
      { rank: 2, wallet: 'w2', lamports: 150_000_000 + 10_000_000 },
      { rank: 3, wallet: 'w3', lamports: 100_000_000 + 10_000_000 },
      { rank: 4, wallet: 'w4', lamports: 10_000_000 },
    ]);
    expect(sum(p)).toBe(700_000_000);
  });

  it('fewer riders: the top-20 share is split among those there are; missing top-3 places stay in the vault', () => {
    const p = poolPayouts(700_000_000, wallets(2));
    expect(p).toEqual([{ rank: 1, wallet: 'w1', lamports: 350_000_000 }, { rank: 2, wallet: 'w2', lamports: 250_000_000 }]);
    expect(poolPayouts(700_000_000, [])).toEqual([]);
  });

  it('never more than the prize, whatever the amounts (floors); zero amounts are left out', () => {
    for (const prize of [0, 1, 69, 70, 999_999_937, 123_456_789_012]) {
      for (const n of [1, 3, 7, 20, 40]) expect(sum(poolPayouts(prize, wallets(n))), `${prize}/${n}`).toBeLessThanOrEqual(prize);
    }
    expect(poolPayouts(10, wallets(20)).every((x) => x.lamports > 0)).toBe(true);
    expect(() => poolPayouts(-1, [])).toThrow(RangeError);
  });
});
