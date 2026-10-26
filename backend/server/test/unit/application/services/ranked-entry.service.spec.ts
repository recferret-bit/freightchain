import { convoyContext } from '../../../support/convoy-context.js';
import { convoyPolicy } from '../../../../src/application/referral/convoy-policy.js';
import { RankedEntryService } from '../../../../src/application/services/ranked-entry.service.js';
import { PrizeGeoPort } from '../../../../src/application/ports/prize/prize-geo.port.js';
import { HeaderGeoAdapter } from '../../../../src/infrastructure/prize/header-geo.adapter.js';
import type { EnvService } from '../../../../src/infrastructure/config/env.service.js';
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
  const setup = (lists = new Lists(), geo = new HeaderGeoAdapter()) => {
    const ctx = unitContext();
    const entry = new RankedEntryService(ctx.rides, geo, lists);
    const claim = async (ride: Ride, headers: Record<string, string> = CA) => entry.claim(await ctx.storedPlayer(ride.wallet), ride, headers, ctx.now());
    return { ctx, claim };
  };

  it('gates Convoy promo ranking by saved activation policy', async () => {
    const c = convoyContext(); await c.accept('w');
    const ride = Ride.createPromo({ id: 'convoy-promo', wallet: 'w', tier: '1h', seed: 1, minSeconds: 3600, timeScale: 1, promoCode: 'SYSTEM-CONVOY-1H', now: c.now() });
    const service = new RankedEntryService(c.rides, new HeaderGeoAdapter(), new Lists(), c.settings, c.repo);
    await expect(service.claim(await c.storedPlayer('w'), ride, CA, c.now())).rejects.toMatchObject({ errorCode: 'convoy_promo_unranked' });
    await c.repo.insert({ referee: 'w', referrer: 'host', status: 'active', boundAt: c.now(), expiresAt: c.now(), activatedAt: c.now(), qualifyExpiresAt: c.now(), m1At: null, m2At: null, policy: { ...convoyPolicy(), promoRanked: 1 } });
    expect(await service.claim(await c.storedPlayer('w'), ride, CA, c.now())).toEqual({ country: 'CA', region: null });
    await c.settingsRepo.upsert('referral_referee_promo_ranked', 0);
    expect(await service.claim(await c.storedPlayer('w'), ride, CA, c.now())).toEqual({ country: 'CA', region: null });
  });

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

  it('a dev geo fallback lets XX start ranked as the default country; production still 409s, and a blocked code is not replaced', async () => {
    const dev = setup(new Lists(), new HeaderGeoAdapter({ nodeEnv: 'test', prizeDevDefaultCountry: 'US' } as EnvService));
    const ride = await dev.ctx.paidOrder('w', 50_000_000, { offer: false });
    const player = await dev.ctx.storedPlayer('w');
    player.setAgreements({ age18: true, loss: false }, dev.ctx.now());
    await dev.ctx.players.save(player);
    expect(await dev.claim(ride, {})).toEqual({ country: 'US', region: null });
    expect(await dev.claim(ride, { 'cf-ipcountry': 'XX' })).toEqual({ country: 'US', region: null });
    expect(await dev.claim(ride, { 'cf-ipcountry': 'T1' })).toEqual({ country: 'US', region: null });
    await expect(dev.claim(ride, { 'cf-ipcountry': 'KP' })).rejects.toMatchObject({ errorCode: 'ranked_ineligible' });
    await expect(dev.claim(ride, { 'cf-ipcountry': 'DE' })).rejects.toMatchObject({ errorCode: 'ranked_ineligible' });
    const prod = setup(new Lists(), new HeaderGeoAdapter({ nodeEnv: 'production', prizeDevDefaultCountry: 'US' } as EnvService));
    const late = await prod.ctx.paidOrder('w', 50_000_000, { offer: false });
    const adult = await prod.ctx.storedPlayer('w');
    adult.setAgreements({ age18: true, loss: false }, prod.ctx.now());
    await prod.ctx.players.save(adult);
    await expect(prod.claim(late, {})).rejects.toMatchObject({ errorCode: 'ranked_ineligible' });
    await expect(prod.claim(late, { 'cf-ipcountry': 'XX' })).rejects.toMatchObject({ errorCode: 'ranked_ineligible' });
    await expect(prod.claim(late, { 'cf-ipcountry': 'IR' })).rejects.toMatchObject({ errorCode: 'ranked_ineligible' });
  });
});

it('only permits the reserved attempt inside the configured event window and refuses a second ranked start', async () => {
  const { PRESEASON_PROMO_CODE } = await import('../../../../src/domain/settings/preseason-event.js');
  const ctx = unitContext();
  await ctx.accept('w');
  const svc = new RankedEntryService(ctx.rides, new HeaderGeoAdapter(), new Lists(), ctx.settings);
  const now = ctx.now().getTime() / 1000;
  const ride = Ride.createPromo({ id: 'event', wallet: 'w', tier: '1h', seed: 1, minSeconds: 3600, timeScale: 1, promoCode: PRESEASON_PROMO_CODE, now: ctx.now() });
  const claim = () => svc.claim(awaitPlayer, ride, CA, ctx.now());
  const awaitPlayer = await ctx.storedPlayer('w');
  await expect(claim()).rejects.toMatchObject({ errorCode: 'event_closed' });
  for (const [key, value] of Object.entries({ event_mode_enabled: 1, event_week_start_utc: now, event_last_start_utc: now + 86400, event_week_end_utc: now + 100000 })) await ctx.settingsRepo.upsert(key, value);
  expect(await claim()).toEqual({ country: 'CA', region: null });
  const ordinary = Ride.createPromo({ id: 'ordinary', wallet: 'w', tier: '1h', seed: 1, minSeconds: 3600, timeScale: 1, promoCode: 'ORDINARY', now: ctx.now() });
  await expect(svc.claim(awaitPlayer, ordinary, CA, ctx.now())).rejects.toMatchObject({ errorCode: 'event_attempt_required' });
  await ctx.rides.insert(ride); ride.start(ctx.now(), null, 0, { country: 'CA', region: null }); await ctx.rides.save(ride);
  await expect(claim()).rejects.toMatchObject({ errorCode: 'event_attempt_used' });
  ctx.clock.advance(86401);
  await expect(claim()).rejects.toMatchObject({ errorCode: 'event_closed' });
});
