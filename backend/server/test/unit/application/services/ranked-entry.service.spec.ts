import { RankedEntryService } from '../../../../src/application/services/ranked-entry.service.js';
import { PrizeGeoPort } from '../../../../src/application/ports/prize/prize-geo.port.js';
import { HeaderGeoAdapter } from '../../../../src/infrastructure/prize/header-geo.adapter.js';
import { DEFAULT_GEO, type PrizeGeoRules } from '../../../../src/domain/prize/prize-rules.js';
import { Ride } from '../../../../src/domain/rides/ride.entity.js';
import { RideStatus } from '../../../../src/domain/rides/ride-status.js';
import { unitContext } from '../../../support/unit-context.js';

class Lists extends PrizeGeoPort {
  constructor(private readonly geo: PrizeGeoRules = DEFAULT_GEO) { super(); }
  rules(): PrizeGeoRules { return this.geo; }
}

const CA = { 'cf-ipcountry': 'CA' };

describe('RankedEntryService', () => {
  const setup = (lists = new Lists()) => {
    const ctx = unitContext();
    const entry = new RankedEntryService(ctx.rides, new HeaderGeoAdapter(), lists);
    const claim = async (ride: Ride, headers: Record<string, string> = CA) => entry.claim(await ctx.storedPlayer(ride.wallet), ride, headers, ctx.now());
    return { ctx, claim };
  };

  it('stamps an allowed country for an 18+ wallet, and refuses age, unknown, sanctioned, UK/EU and a blocked US state', async () => {
    const { ctx, claim } = setup();
    const ride = await ctx.paidOrder('w', 50_000_000, { offer: false });
    await expect(claim(ride)).rejects.toMatchObject({ errorCode: 'ranked_ineligible' });
    const player = await ctx.storedPlayer('w');
    player.setAgreements({ age18: true, loss: false }, ctx.now());
    await ctx.players.save(player);
    expect(await claim(ride, CA)).toEqual({ country: 'CA', region: null });
    await expect(claim(ride, { 'cf-ipcountry': 'XX' })).rejects.toMatchObject({ errorCode: 'ranked_ineligible' });
    await expect(claim(ride, { 'x-fc-country': 'KP' })).rejects.toThrow(/sanctioned/);
    await expect(claim(ride, { 'cf-ipcountry': 'DE' })).rejects.toThrow(/region/);
    await expect(claim(ride, { 'cf-ipcountry': 'GB' })).rejects.toThrow(/region/);
    await expect(claim(ride, { 'cf-ipcountry': 'US', 'cf-region-code': 'SC' })).rejects.toThrow(/us-state/);
    expect(await claim(ride, { 'CF-IPCountry': 'US', 'CF-Region-Code': 'CA' })).toEqual({ country: 'US', region: 'CA' });
  });

  it('refuses a training ride before geo, then caps paid ranked starts at 5 for the prize week', async () => {
    const { ctx, claim } = setup();
    await ctx.accept('w');
    const training = await ctx.freeRide('w');
    await expect(claim(training, {})).rejects.toMatchObject({ errorCode: 'ranked_training' });
    const paid = async (id: string, go: boolean) => {
      const ride = Ride.createPaidOrder({ id, wallet: 'w', tier: '1h', seed: 2, minSeconds: 3600, timeScale: 1, priceUsd: 5, lamports: 1, solUsd: 100, now: ctx.now(), quoteTtlMs: 60_000 });
      ride.markPaid(1, ctx.now());
      await ctx.rides.insert(ride);
      if (!go) return ride;
      await claim(ride);
      ride.start(ctx.now(), null, 0, { country: 'CA', region: null });
      await ctx.rides.save(ride);
      const done = await ctx.reload(id); done.finish('failed', null, ctx.now()); await ctx.rides.save(done);
      return ride;
    };
    for (const id of ['p1', 'p2', 'p3', 'p4', 'p5']) await paid(id, true);
    const sixth = await paid('p6', false);
    await expect(claim(sixth)).rejects.toMatchObject({ errorCode: 'ranked_paid_cap' });
    expect(sixth.status).toBe(RideStatus.Created);
    ctx.clock.advance(8 * 86_400);
    expect(await claim(sixth)).toEqual({ country: 'CA', region: null });
  });

  it('refuses a ranked start that cannot finish by Sunday 12:00 UTC, and a second promo start that week', async () => {
    const { ctx, claim } = setup();
    await ctx.accept('w');
    ctx.clock.advance((3 * 24 + 16) * 3600 + 1); // Sunday 04:00:01 UTC
    const late = Ride.createPaidOrder({ id: 'late', wallet: 'w', tier: '8h', seed: 1, minSeconds: 8 * 3600, timeScale: 1, priceUsd: 50, lamports: 1, solUsd: 100, now: ctx.now(), quoteTtlMs: 60_000 });
    late.markPaid(1, ctx.now());
    await expect(claim(late)).rejects.toMatchObject({ errorCode: 'ranked_window' });
    const promo = Ride.createPromo({ id: 'pr', wallet: 'w', tier: '1h', seed: 1, minSeconds: 60, timeScale: 1, promoCode: 'HAUL', now: ctx.now() });
    await ctx.rides.insert(promo);
    await claim(promo);
    promo.start(ctx.now(), null, 0, { country: 'CA', region: null });
    await ctx.rides.save(promo);
    const second = Ride.createPromo({ id: 'pr2', wallet: 'w', tier: '1h', seed: 1, minSeconds: 60, timeScale: 1, promoCode: 'NEXT', now: ctx.now() });
    await expect(claim(second)).rejects.toMatchObject({ errorCode: 'ranked_promo_cap' });
    expect(second.status).toBe(RideStatus.Created);
  });

  it('an env list replaces the default block', async () => {
    const { ctx, claim } = setup(new Lists({ sanctionedCountries: ['CA'], prizeBlockedCountries: [], blockedUsStates: [] }));
    const ride = await ctx.paidOrder('w', 50_000_000, { offer: false });
    const player = await ctx.storedPlayer('w');
    player.setAgreements({ age18: true, loss: false }, ctx.now());
    await ctx.players.save(player);
    await expect(claim(ride, CA)).rejects.toThrow(/sanctioned/);
    expect(await claim(ride, { 'cf-ipcountry': 'GB' })).toEqual({ country: 'GB', region: null });
  });
});
