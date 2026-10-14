import { HONK_EMISSION_CAP } from '../../../../src/domain/honk/tokenomics.js';
import { unitContext } from '../../../support/unit-context.js';

const U = 1_000_000n;
const input = (over: Partial<{ rideId: string; wallet: string; tier: string; distance: number; completeDist: number }> = {}) => ({
  rideId: 'r1', wallet: 'w', tier: '1h', distance: 10_000, completeDist: 10_000, ...over,
});

describe('HonkMintService', () => {
  it('credits a verified checkpoint once, and a second call does not mint again', async () => {
    const ctx = unitContext();
    const row = await ctx.honkMint.credit(input());
    expect(row).toMatchObject({ rideId: 'r1', wallet: 'w', amount: 100n * U, band20: true, band50: true, band100: true });
    expect(await ctx.honkRepo.balance('w')).toBe(100n * U);
    expect((await ctx.honkRepo.account('w')).minted).toBe(100n * U);
    expect(ctx.db.honkEmission).toBe(100n * U);
    expect(await ctx.honkMint.credit(input({ distance: 10_000 }))).toMatchObject({ amount: 100n * U });
    expect(await ctx.honkRepo.balance('w')).toBe(100n * U);
    expect(ctx.db.honkMints.size).toBe(1);
  });

  it('a ride that reached no band, a free tier, or a closed cap inserts nothing', async () => {
    const ctx = unitContext();
    expect(await ctx.honkMint.credit(input({ distance: 0 }))).toBeNull();
    expect(await ctx.honkMint.credit(input({ rideId: 'free', tier: 'free' }))).toBeNull();
    ctx.db.honkEmission = HONK_EMISSION_CAP;
    expect(await ctx.honkMint.credit(input({ rideId: 'late' }))).toBeNull();
    expect(ctx.db.honkMints.size).toBe(0);
  });

  it('a mint that does not fit takes the remainder and then the cap is closed', async () => {
    const ctx = unitContext();
    ctx.db.honkEmission = HONK_EMISSION_CAP - 10n * U;
    expect(await ctx.honkMint.credit(input())).toMatchObject({ amount: 10n * U });
    expect(ctx.db.honkEmission).toBe(HONK_EMISSION_CAP);
    expect(await ctx.honkMint.credit(input({ rideId: 'next' }))).toBeNull();
    expect(await ctx.honkRepo.balance('w')).toBe(10n * U);
  });

  it('20% only is 15, through 50% is 40, and an 8h finish is 2000', async () => {
    const ctx = unitContext();
    expect(await ctx.honkMint.credit(input({ rideId: 'a', distance: 1999 }))).toMatchObject({ amount: 15n * U, band20: true, band50: false, band100: false });
    expect(await ctx.honkMint.credit(input({ rideId: 'b', distance: 4999 }))).toMatchObject({ amount: 40n * U, band50: true, band100: false });
    expect(await ctx.honkMint.credit(input({ rideId: 'c', tier: '8h', wallet: 'z' }))).toMatchObject({ amount: 2000n * U, band100: true });
    expect(await ctx.honkRepo.counts('w')).toEqual({ mints: 2, finishes: 0 });
    expect(await ctx.honkRepo.counts('z')).toEqual({ mints: 1, finishes: 1 });
  });
});
