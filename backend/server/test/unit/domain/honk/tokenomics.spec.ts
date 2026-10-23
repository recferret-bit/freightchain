import { COSMETIC_ITEMS, COSMETIC_SLOTS, defaultCosmetic } from '../../../../src/domain/economy/cosmetics.js';
import { GIFT_ITEMS } from '../../../../src/domain/referral/referral-rules.js';
import { HONK_PARTS } from '../../../../src/domain/honk/parts-catalog.js';
import {
  HONK_AIRDROP,
  HONK_AIRDROP_WALLET_CAP,
  HONK_AIRDROP_WINDOW_DAYS,
  HONK_DAILY_GLOBAL_ERA1,
  HONK_DAILY_WALLET,
  HONK_DECIMALS,
  HONK_EMISSION_CAP,
  HONK_ERA_SIZE,
  HONK_LIQUIDITY,
  HONK_MAX_SUPPLY,
  HONK_REFERRAL,
  HONK_REFERRAL_ERA_SIZE,
  HONK_REFERRAL_MONTHLY_GLOBAL,
  HONK_REFERRAL_MONTHLY_WALLET,
  HONK_REFERRAL_SOFT_START_GLOBAL,
  HONK_TEAM,
  HONK_TEAM_CLIFF_MONTHS,
  HONK_TEAM_LINEAR_MONTHS,
  HONK_TREASURY,
  TOKEN_SYMBOL,
  bandAmounts,
  bandBits,
  clipPayout,
  clipReferralPayout,
  eraIndex,
  eraRemaining,
  finishUnits,
  formatHonk,
  holdMs,
  honkQuote,
  referralEraIndex,
  referralMonthlyGlobalCap,
  referralQuoteUnits,
  visualPrice,
} from '../../../../src/domain/honk/tokenomics.js';

const U = 1_000_000n;
const full = (tier: string) => tier === '8h' ? 1200n * U : tier === '4h' ? 500n * U : 100n * U;

describe('TEN4 quote', () => {
  it('TEN-T-01 formats base units with 6 decimals, trimming trailing zeros', () => {
    expect(HONK_DECIMALS).toBe(6);
    expect(formatHonk(0n)).toBe('0');
    expect(formatHonk(100n * U)).toBe('100');
    expect(formatHonk(15n * U)).toBe('15');
    expect(formatHonk(1_500_000n)).toBe('1.5');
    expect(formatHonk(-U)).toBe('-1');
    expect(TOKEN_SYMBOL).toBe('TEN4');
  });

  it('keeps the 100M fixed supply split across liquidity, emission, 8M airdrop, 4M referral, treasury, and 8M team', () => {
    expect(HONK_MAX_SUPPLY).toBe(100_000_000n * U);
    expect(HONK_AIRDROP).toBe(8_000_000n * U);
    expect(HONK_REFERRAL).toBe(4_000_000n * U);
    expect(HONK_TEAM).toBe(8_000_000n * U);
    expect(HONK_TEAM_CLIFF_MONTHS).toBe(12);
    expect(HONK_TEAM_LINEAR_MONTHS).toBe(24);
    expect(HONK_AIRDROP_WALLET_CAP).toBe(2_000n * U);
    expect(HONK_AIRDROP_WINDOW_DAYS).toBe(90);
    expect(HONK_LIQUIDITY + HONK_EMISSION_CAP + HONK_AIRDROP + HONK_REFERRAL + HONK_TREASURY + HONK_TEAM).toBe(HONK_MAX_SUPPLY);
    expect(HONK_ERA_SIZE).toBe(27_500_000n * U);
    expect(HONK_REFERRAL_ERA_SIZE).toBe(2_000_000n * U);
    expect(HONK_EMISSION_CAP).toBe(55_000_000n * U);
  });

  it('scales referral payouts by max(era_ref, era_ride) and enforces soft-start and monthly caps', () => {
    expect(referralEraIndex(0n)).toBe(0);
    expect(referralEraIndex(HONK_REFERRAL_ERA_SIZE)).toBe(1);
    expect(referralMonthlyGlobalCap(0)).toBe(HONK_REFERRAL_SOFT_START_GLOBAL);
    expect(referralMonthlyGlobalCap(2)).toBe(30_000n * U);
    expect(referralMonthlyGlobalCap(3)).toBe(HONK_REFERRAL_MONTHLY_GLOBAL);
    expect(referralQuoteUnits(100n * U, 0n, 0n)).toEqual({ quote: 100n * U, era: 0 });
    expect(referralQuoteUnits(100n * U, HONK_REFERRAL_ERA_SIZE, 0n)).toEqual({ quote: 50n * U, era: 1 });
    expect(referralQuoteUnits(100n * U, 0n, HONK_ERA_SIZE + HONK_ERA_SIZE / 2n)).toEqual({ quote: 25n * U, era: 2 });
    expect(clipReferralPayout(100n * U, 0n, 0, 0n, 950n * U)).toEqual({ amount: 50n * U, reason: 'ok' });
    expect(clipReferralPayout(100n * U, 0n, 0, 0n, HONK_REFERRAL_MONTHLY_WALLET).reason).toBe('wallet');
    expect(clipReferralPayout(100n * U, 0n, 0, HONK_REFERRAL_SOFT_START_GLOBAL, 0n).reason).toBe('daily');
    expect(clipReferralPayout(100n * U, 0n, 3, HONK_REFERRAL_SOFT_START_GLOBAL, 0n)).toEqual({ amount: 100n * U, reason: 'ok' });
  });

  it('TEN-T-02 TEN-T-04 pays 15 / 25 / 60 of the era-0 finish at 20 / 50 / 100, with the +1 m finish', () => {
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
    expect(bandAmounts('8h', 1999, line).quote).toBe(180n * U);
    expect(bandAmounts('8h', 4999, line).quote).toBe(480n * U);
    expect(bandAmounts('8h', line, line).quote).toBe(full('8h'));
    expect(bandAmounts('8h', line, line, HONK_ERA_SIZE).quote).toBe(600n * U);
    for (const tier of ['free', 'nope', '1h']) expect(bandAmounts(tier, 100, tier === '1h' ? 0 : 10_000).quote, tier).toBe(0n);
  });

  it('TEN-T-07 TEN-T-08 clips to the tightest room and names the cap that closed it', () => {
    expect(clipPayout(100n * U, 0n, 0n, 0n)).toEqual({ amount: 100n * U, reason: 'ok' });
    expect(clipPayout(100n * U, HONK_ERA_SIZE - 10n * U, 0n, 0n)).toEqual({ amount: 10n * U, reason: 'ok' });
    expect(clipPayout(100n * U, HONK_EMISSION_CAP, 0n, 0n).reason).toBe('emission');
    expect(clipPayout(1200n * U, HONK_ERA_SIZE - 50n * U, 0n, 0n).amount).toBe(50n * U);
    expect(clipPayout(100n * U, 0n, HONK_DAILY_GLOBAL_ERA1, 0n).reason).toBe('daily');
    expect(clipPayout(1200n * U, 0n, 0n, HONK_DAILY_WALLET - 800n * U).amount).toBe(800n * U);
    expect(clipPayout(100n * U, 0n, 0n, HONK_DAILY_WALLET).reason).toBe('wallet');
    expect(holdMs('8h')).toBe(48 * 60 * 60 * 1000);
    expect(holdMs('1h')).toBe(0);
    expect(holdMs('4h')).toBe(0);
  });

  it('TEN-T-05 packs every band combination into bits 0..7', () => {
    const bit = (band20: boolean, band50: boolean, band100: boolean) => bandBits({ band20, band50, band100 });
    expect(bit(false, false, false)).toBe(0);
    expect(bit(true, false, false)).toBe(1);
    expect(bit(false, true, false)).toBe(2);
    expect(bit(true, true, false)).toBe(3);
    expect(bit(false, false, true)).toBe(4);
    expect(bit(true, false, true)).toBe(5);
    expect(bit(false, true, true)).toBe(6);
    expect(bit(true, true, true)).toBe(7);
  });

  it('TEN-T-06 walks the emission era boundaries and the shifted finish', () => {
    const at41 = HONK_ERA_SIZE + HONK_ERA_SIZE / 2n;
    expect(eraIndex(0n)).toBe(0);
    expect(eraIndex(HONK_ERA_SIZE - 1n)).toBe(0);
    expect(eraIndex(HONK_ERA_SIZE)).toBe(1);
    expect(eraIndex(at41 - 1n)).toBe(1);
    expect(eraIndex(at41)).toBe(2);
    expect(eraIndex(HONK_EMISSION_CAP)).toBe(63);
    expect(eraRemaining(0n)).toBe(HONK_ERA_SIZE);
    expect(eraRemaining(HONK_ERA_SIZE)).toBe(HONK_ERA_SIZE / 2n);
    expect(eraRemaining(HONK_EMISSION_CAP)).toBe(0n);
    expect(finishUnits('1h', 0)).toBe(100n * U);
    expect(finishUnits('4h', 0)).toBe(500n * U);
    expect(finishUnits('8h', 0)).toBe(1200n * U);
    expect(finishUnits('8h', 1)).toBe(600n * U);
    expect(finishUnits('free', 0)).toBeNull();
  });

  it('prices gold at 260 and every other part at 65', () => {
    expect(visualPrice('gold')).toBe(260n * U);
    expect(visualPrice('crimson')).toBe(65n * U);
  });

  it('TEN-T-09 the HONK catalog excludes referral paints, and an unlockable costs visualPrice', () => {
    expect(COSMETIC_SLOTS).toHaveLength(9);
    expect(COSMETIC_SLOTS.flatMap((slot) => COSMETIC_ITEMS[slot])).toHaveLength(57);
    expect(HONK_PARTS).toHaveLength(54);
    expect(HONK_PARTS.filter((p) => p.price == null)).toHaveLength(9);
    expect(HONK_PARTS.filter((p) => p.price === 65n * U)).toHaveLength(37);
    expect(HONK_PARTS.filter((p) => p.price === 260n * U)).toHaveLength(8);
    expect(HONK_PARTS.map((p) => p.sort)).toEqual(HONK_PARTS.map((_, i) => i));
    expect(HONK_PARTS.map((p) => `${p.slot}:${p.item}`)).toEqual(COSMETIC_SLOTS.flatMap((slot) => COSMETIC_ITEMS[slot].filter((item) => slot !== 'truck_color' || !(GIFT_ITEMS as readonly string[]).includes(item)).map((item) => `${slot}:${item}`)));
    for (const p of HONK_PARTS) expect(p.price, `${p.slot}:${p.item}`).toBe(p.item === defaultCosmetic(p.slot) ? null : visualPrice(p.item));
  });

  it('TEN-T-03 previews before a verdict, holds an 8h pass, mints a 1h pass, and withholds a flag', () => {
    const line = 10_000;
    const preview = honkQuote('1h', line, line, null);
    expect(preview).toMatchObject({ state: 'preview', pays: '0', quote: '100', full: '100' });
    expect(preview.bands.map((b) => b.pct)).toEqual([20, 50, 100]);
    expect(preview.bands.every((b) => b.reached)).toBe(true);
    expect(honkQuote('1h', 1999, line, null)).toMatchObject({ state: 'preview', quote: '15', bands: [{ pct: 20, reached: true, amount: '15' }, { pct: 50, reached: false, amount: '25' }, { pct: 100, reached: false, amount: '60' }] });
    expect(honkQuote('4h', line, line, 'verified')).toMatchObject({ state: 'minted', pays: '500', quote: '500', full: '500' });
    expect(honkQuote('8h', line, line, 'verified')).toMatchObject({ state: 'pending', pays: '0', quote: '1200', full: '1200' });
    expect(honkQuote('8h', line, line, 'verified', { paid: true })).toMatchObject({ state: 'minted', pays: '1200' });
    expect(honkQuote('1h', 0, line, 'verified')).toMatchObject({ state: 'none', pays: '0', quote: '0' });
    expect(honkQuote('1h', line, line, 'flagged')).toMatchObject({ state: 'withheld', pays: '0', quote: '100' });
    expect(honkQuote('1h', line, line, 'rejected')).toMatchObject({ state: 'withheld', pays: '0', quote: '100' });
    expect(honkQuote('free', line, line, 'verified')).toEqual({ state: 'none', pays: '0', quote: '0', full: '0', bands: [] });
  });
});
