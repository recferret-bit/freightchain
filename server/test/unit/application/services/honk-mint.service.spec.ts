import { HONK_EMISSION_CAP, HONK_ERA_SIZE } from '../../../../src/domain/honk/tokenomics.js';
import { unitContext } from '../../../support/unit-context.js';

const U = 1_000_000n;
const input = (over: Partial<{ rideId: string; wallet: string; tier: string; distance: number; completeDist: number }> = {}) => ({
  rideId: 'r1', wallet: 'w', tier: '1h', distance: 10_000, completeDist: 10_000, ...over,
});

describe('HonkMintService', () => {
  it('credits a verified checkpoint once, and a second call does not mint again', async () => {
    const ctx = unitContext();
    expect(await ctx.honkMint.credit(input())).toBe(100n * U);
    expect(await ctx.honkRepo.findMint('r1')).toMatchObject({ rideId: 'r1', wallet: 'w', amount: 100n * U, band20: true, band50: true, band100: true });
    expect(await ctx.honkRepo.balance('w')).toBe(100n * U);
    expect((await ctx.honkRepo.account('w')).minted).toBe(100n * U);
    expect(ctx.db.honkEmission).toBe(100n * U);
    expect(await ctx.honkMint.credit(input({ distance: 10_000 }))).toBeNull();
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

  it('a mint at the end of an era takes the remainder, then the next era pays half', async () => {
    const ctx = unitContext();
    ctx.db.honkEmission = HONK_ERA_SIZE - 10n * U;
    expect(await ctx.honkMint.credit(input())).toBe(10n * U);
    expect(ctx.db.honkEmission).toBe(HONK_ERA_SIZE);
    expect(await ctx.honkMint.credit(input({ rideId: 'next' }))).toBe(50n * U);
    expect(await ctx.honkRepo.balance('w')).toBe(60n * U);
  });

  it('20% only is 15, through 50% is 40, and an 8h finish is held for 48h', async () => {
    const ctx = unitContext();
    expect(await ctx.honkMint.credit(input({ rideId: 'a', distance: 1999 }))).toBe(15n * U);
    expect(await ctx.honkRepo.findMint('a')).toMatchObject({ amount: 15n * U, band20: true, band50: false, band100: false });
    expect(await ctx.honkMint.credit(input({ rideId: 'b', distance: 4999 }))).toBe(40n * U);
    expect(await ctx.honkRepo.findMint('b')).toMatchObject({ amount: 40n * U, band50: true, band100: false });
    expect(await ctx.honkMint.credit(input({ rideId: 'c', tier: '8h', wallet: 'z' }))).toBeNull();
    expect(await ctx.honkRepo.findMint('c')).toMatchObject({ amount: 1200n * U, band100: true, released: false });
    expect(await ctx.honkRepo.balance('z')).toBe(0n);
    expect(await ctx.honkRepo.counts('w')).toEqual({ mints: 2, finishes: 0 });
    expect(await ctx.honkRepo.counts('z')).toEqual({ mints: 0, finishes: 0 });
    ctx.clock.advance(48 * 3600);
    expect(await ctx.honkMint.releaseIfDue('c')).toBe(1200n * U);
    expect(await ctx.honkRepo.balance('z')).toBe(1200n * U);
    expect(await ctx.honkRepo.counts('z')).toEqual({ mints: 1, finishes: 1 });
    expect(ctx.db.honkEmission).toBe(15n * U + 40n * U + 1200n * U);
  });

  it('an 8h reservation counts toward the wallet day, and a reject before release gives it back', async () => {
    const ctx = unitContext();
    expect(await ctx.honkMint.credit(input({ rideId: 'e1', tier: '8h' }))).toBeNull();
    expect(await ctx.honkMint.credit(input({ rideId: 'e2', tier: '8h' }))).toBeNull();
    expect(await ctx.honkRepo.findMint('e2')).toMatchObject({ amount: 800n * U });
    expect(await ctx.honkMint.credit(input({ rideId: 'e3', tier: '8h' }))).toBeNull();
    expect(await ctx.honkRepo.findMint('e3')).toBeNull();
    expect(await ctx.honkMint.credit(input({ rideId: 'other', tier: '8h', wallet: 'z' }))).toBeNull();
    expect(await ctx.honkRepo.findMint('other')).toMatchObject({ amount: 1200n * U });
    expect(await ctx.honkMint.cancelPending('e1')).toBe(1200n * U);
    expect(await ctx.honkRepo.findMint('e1')).toBeNull();
    expect(ctx.db.honkEmission).toBe(800n * U + 1200n * U);
    ctx.clock.advance(48 * 3600);
    expect(await ctx.honkMint.releaseIfDue('e2')).toBe(800n * U);
    expect(await ctx.honkMint.cancelPending('e2')).toBeNull();
    expect(await ctx.honkRepo.balance('w')).toBe(800n * U);
  });
});
