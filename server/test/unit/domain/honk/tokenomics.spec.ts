import { COSMETIC_ITEMS, COSMETIC_SLOTS, defaultCosmetic } from '../../../../src/domain/economy/cosmetics.js';
import { HONK_PARTS } from '../../../../src/domain/honk/parts-catalog.js';
import { HONK_EMISSION_CAP, HONK_GENESIS, HONK_MAX_SUPPLY, bandAmounts, clipToCap, formatHonk, honkQuote, visualPrice } from '../../../../src/domain/honk/tokenomics.js';

const U = 1_000_000n;
const full = (tier: string) => tier === '8h' ? 2000n * U : tier === '4h' ? 500n * U : 100n * U;

describe('HONK quote', () => {
  it('formats base units with 6 decimals, trimming trailing zeros', () => {
    expect(formatHonk(0n)).toBe('0');
    expect(formatHonk(100n * U)).toBe('100');
    expect(formatHonk(15n * U)).toBe('15');
    expect(formatHonk(1_500_000n)).toBe('1.5');
    expect(formatHonk(-U)).toBe('-1');
  });

  it('keeps the supply split: genesis is the pool, rides stop at the rest, burns do not raise it', () => {
    expect(HONK_MAX_SUPPLY).toBe(100_000_000n * U);
    expect(HONK_GENESIS).toBe(2_000_000n * U);
    expect(HONK_EMISSION_CAP).toBe(98_000_000n * U);
  });

  it('pays 15 / 25 / 60 of the tier mint at 20 / 50 / 100, with the +1 m finish', () => {
    const line = 10_000;
    expect(bandAmounts('1h', 1998, line).quote).toBe(0n);
    expect(bandAmounts('1h', 1999, line)).toMatchObject({ quote: 15n * U });
    expect(bandAmounts('1h', 4998, line).quote).toBe(15n * U);
    expect(bandAmounts('1h', 4999, line).quote).toBe(40n * U);
    expect(bandAmounts('1h', 9998, line).quote).toBe(40n * U);
    expect(bandAmounts('1h', 9999, line).quote).toBe(full('1h'));
    expect(bandAmounts('4h', 1999, line).quote).toBe(75n * U);
    expect(bandAmounts('4h', 4999, line).quote).toBe(200n * U);
    expect(bandAmounts('4h', line, line).quote).toBe(full('4h'));
    expect(bandAmounts('8h', 1999, line).quote).toBe(300n * U);
    expect(bandAmounts('8h', 4999, line).quote).toBe(800n * U);
    expect(bandAmounts('8h', line, line).quote).toBe(full('8h'));
    for (const tier of ['free', 'nope', '1h']) expect(bandAmounts(tier, 100, tier === '1h' ? 0 : 10_000).quote, tier).toBe(0n);
  });

  it('clips to the room left under the emission cap and mints nothing once it is closed', () => {
    expect(clipToCap(100n * U, 0n)).toBe(100n * U);
    expect(clipToCap(100n * U, HONK_EMISSION_CAP - 10n * U)).toBe(10n * U);
    expect(clipToCap(100n * U, HONK_EMISSION_CAP)).toBe(0n);
    expect(clipToCap(0n, 0n)).toBe(0n);
  });

  it('prices gold at 260 and every other part at 65', () => {
    expect(visualPrice('gold')).toBe(260n * U);
    expect(visualPrice('crimson')).toBe(65n * U);
  });

  it('the cab catalog is the 30 cosmetics, and an unlockable costs visualPrice', () => {
    expect(HONK_PARTS).toHaveLength(54);
    expect(HONK_PARTS.map((p) => p.sort)).toEqual(HONK_PARTS.map((_, i) => i));
    expect(HONK_PARTS.map((p) => `${p.slot}:${p.item}`)).toEqual(COSMETIC_SLOTS.flatMap((slot) => COSMETIC_ITEMS[slot].map((item) => `${slot}:${item}`)));
    for (const p of HONK_PARTS) expect(p.price, `${p.slot}:${p.item}`).toBe(p.item === defaultCosmetic(p.slot) ? null : visualPrice(p.item));
  });

  it('previews before a verdict, mints on a pass, withholds a flag or a reject, and is silent on a free ride', () => {
    const line = 10_000;
    const preview = honkQuote('1h', line, line, null);
    expect(preview).toMatchObject({ state: 'preview', pays: '0', quote: '100', full: '100' });
    expect(preview.bands.map((b) => b.pct)).toEqual([20, 50, 100]);
    expect(preview.bands.every((b) => b.reached)).toBe(true);
    expect(honkQuote('1h', 1999, line, null)).toMatchObject({ state: 'preview', quote: '15', bands: [{ pct: 20, reached: true, amount: '15' }, { pct: 50, reached: false, amount: '25' }, { pct: 100, reached: false, amount: '60' }] });
    expect(honkQuote('4h', line, line, 'verified')).toMatchObject({ state: 'minted', pays: '500', quote: '500', full: '500' });
    expect(honkQuote('8h', line, line, 'verified')).toMatchObject({ state: 'minted', pays: '2000', quote: '2000', full: '2000' });
    expect(honkQuote('1h', 0, line, 'verified')).toMatchObject({ state: 'none', pays: '0', quote: '0' });
    expect(honkQuote('1h', line, line, 'flagged')).toMatchObject({ state: 'withheld', pays: '0', quote: '100' });
    expect(honkQuote('1h', line, line, 'rejected')).toMatchObject({ state: 'withheld', pays: '0', quote: '100' });
    expect(honkQuote('free', line, line, 'verified')).toEqual({ state: 'none', pays: '0', quote: '0', full: '0', bands: [] });
  });
});
