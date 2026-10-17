import { ReferralService } from '../../../../src/application/services/referral.service.js';
import { BadRequestError, ConflictError } from '../../../../src/domain/shared/errors.js';
import { Ride } from '../../../../src/domain/rides/ride.entity.js';
import { RideStatus } from '../../../../src/domain/rides/ride-status.js';
import type { FreeLevel } from '../../../../src/domain/rides/ride-trip.js';
import { RideVerdict } from '../../../../src/domain/verdict/ride-verdict.entity.js';
import { VerdictStatus } from '../../../../src/domain/verdict/verdict.dto.js';
import { MemoryReferralRepository } from '../../../support/in-memory/memory-referral-repository.js';
import { unitContext, type UnitContext } from '../../../support/unit-context.js';

const HOST = 'HostWa11et11111111111111111111111111111111';
const FRIEND = 'FriendWa11et111111111111111111111111111111';

const service = (ctx: UnitContext) => new ReferralService(
  new MemoryReferralRepository(ctx.db), ctx.players, ctx.transactions, ctx.settings, ctx.cosmetics, ctx.rides, ctx.verdictRepo, ctx.clock, ctx.entropy,
);

async function verifiedFree(ctx: UnitContext, wallet: string, level: FreeLevel, assist = false): Promise<string> {
  const ride = Ride.createFree({ id: ctx.entropy.uuid(), wallet, seed: 1, minSeconds: 10, now: ctx.now(), level, assist: false });
  await ctx.rides.insert(Ride.restore({
    ...ride.snapshot(), status: RideStatus.Completed, startedAt: ctx.now(), endedAt: ctx.now(), lastS: ride.snapshot().completeDist,
    ...(assist ? { assist: true } : {}),
  }));
  await ctx.verdictRepo.save(RideVerdict.restore({ rideId: ride.id, status: VerdictStatus.Verified, reasons: [], scores: {} as never, rulesVersion: 1, judgedAt: ctx.now(), version: 1 }));
  return ride.id;
}

describe('ReferralService', () => {
  it('mints a code on first view and binds a friend who has not started a ride', async () => {
    const ctx = unitContext(), svc = service(ctx);
    await ctx.player(HOST); await ctx.player(FRIEND);
    const view = await svc.view(HOST);
    expect(view).toMatchObject({ capacity: 3, used: 0, pending: 0, available: 3, max: 30, gift: 'convoy', referredBy: null, invites: [] });
    expect(view.code).toMatch(/^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{8}$/);
    await svc.bind(FRIEND, ` ${view.code.toLowerCase()} `);
    expect(await svc.view(FRIEND)).toMatchObject({ referredBy: HOST });
    expect((await svc.view(HOST)).invites).toHaveLength(1);
    await svc.bind(FRIEND, view.code); // the same code again
    expect((await svc.view(HOST)).pending).toBe(1);
  });

  it('refuses own code, an unknown code, a bad code, a second referrer, a started ride, and a full book', async () => {
    const ctx = unitContext(), svc = service(ctx);
    await ctx.player(HOST);
    const { code } = await svc.view(HOST);
    await expect(svc.bind(HOST, code)).rejects.toMatchObject({ errorCode: 'own_code' });
    await ctx.player(FRIEND);
    await expect(svc.bind(FRIEND, 'ZZZZZZZZ')).rejects.toBeInstanceOf(ConflictError);
    await expect(svc.bind(FRIEND, 'IIIIIIII')).rejects.toBeInstanceOf(BadRequestError);
    await ctx.freeRide(FRIEND, true);
    await expect(svc.bind(FRIEND, code)).rejects.toMatchObject({ errorCode: 'ride_started' });
    const open = ['A', 'B', 'C', 'D'].map((n) => `OpenWa11et${n}11111111111111111111111111111`);
    for (const w of open) await ctx.player(w);
    for (const w of open.slice(0, 3)) await svc.bind(w, code);
    await expect(svc.bind(open[3]!, code)).rejects.toMatchObject({ errorCode: 'no_slots' });
  });

  it('an expired invite is a tombstone, and a MEDIUM finish inside the window pays both sides once and paints the gift', async () => {
    const ctx = unitContext(), svc = service(ctx);
    await ctx.player(HOST); await ctx.player(FRIEND);
    const { code } = await svc.view(HOST);
    await svc.gift(HOST, 'signal');
    expect((await svc.view(HOST)).gift).toBe('signal');
    await expect(svc.gift(HOST, 'red')).rejects.toMatchObject({ errorCode: 'bad_gift' });
    await svc.bind(FRIEND, code);
    ctx.clock.advance(15 * 86_400);
    await svc.onVerified(await verifiedFree(ctx, FRIEND, 2));
    expect(await svc.donationReferrer(FRIEND, 'spectator')).toBeNull();
    await expect(svc.bind(FRIEND, code)).rejects.toMatchObject({ errorCode: 'expired' });
    expect((await ctx.storedPlayer(HOST)).freeRides).toBe(10);

    const late = 'LateWa11et1111111111111111111111111111111';
    await ctx.player(late);
    await svc.bind(late, code);
    ctx.clock.advance(8 * 86_400);
    await svc.onVerified(await verifiedFree(ctx, late, 2));
    expect((await ctx.storedPlayer(HOST)).freeRides).toBe(10); // past the 7-day window: qualified, no free rides
    expect(await svc.donationReferrer(late, 'spectator')).toBe(HOST);

    const pal = 'PalWa11et11111111111111111111111111111111';
    await ctx.player(pal);
    await svc.bind(pal, code);
    await svc.onVerified(await verifiedFree(ctx, pal, 2));
    expect((await ctx.storedPlayer(HOST)).freeRides).toBe(12);
    expect((await ctx.storedPlayer(pal)).freeRides).toBe(13);
    expect(await ctx.cosmetics.listEquipped(HOST)).toMatchObject({ truck_color: 'signal' });
    await svc.onVerified(await verifiedFree(ctx, pal, 2));
    expect((await ctx.storedPlayer(HOST)).freeRides).toBe(12); // one grant
  });

  it('an invite is still pending at the exact expiry instant and is a tombstone one millisecond later', async () => {
    const ctx = unitContext(), svc = service(ctx);
    const edge = 'EdgeWa11et111111111111111111111111111111';
    await ctx.player(HOST); await ctx.player(edge);
    const { code } = await svc.view(HOST);
    await svc.bind(edge, code);
    ctx.clock.advance(14 * 86_400);
    expect((await svc.view(HOST)).pending).toBe(1);
    expect((await svc.view(edge)).referredBy).toBe(HOST);
    ctx.clock.advance(0.001);
    expect((await svc.view(HOST)).pending).toBe(0);
    expect((await svc.view(edge)).referredBy).toBeNull();
    await expect(svc.bind(edge, code)).rejects.toMatchObject({ errorCode: 'expired' });
  });

  it('the first bind after the TTL is expired, for the same code and for a different one, and the slot is back', async () => {
    const ctx = unitContext(), svc = service(ctx);
    const edge = 'EdgeWa11et111111111111111111111111111111';
    const pal = 'Pal2Wa11et1111111111111111111111111111111';
    const other = 'OtherWa11et11111111111111111111111111111';
    await ctx.player(HOST); await ctx.player(edge); await ctx.player(pal); await ctx.player(other);
    const { code } = await svc.view(HOST);
    const otherCode = (await svc.view(other)).code;
    await svc.bind(edge, code);
    await svc.bind(pal, code);
    ctx.clock.advance(14 * 86_400 + 0.001);
    await expect(svc.bind(edge, code)).rejects.toMatchObject({ errorCode: 'expired' });
    await expect(svc.bind(pal, otherCode)).rejects.toMatchObject({ errorCode: 'expired' });
    expect((await svc.view(HOST)).pending).toBe(0);
    expect((await svc.view(edge)).referredBy).toBeNull();
    expect((await svc.view(pal)).referredBy).toBeNull();
  });

  it('a later paid finish counts the convoy badge once; HARD with assist on does not', async () => {
    const ctx = unitContext(), svc = service(ctx);
    await ctx.player(HOST); await ctx.player(FRIEND);
    const { code } = await svc.view(HOST);
    await svc.bind(FRIEND, code);
    await svc.onVerified(await verifiedFree(ctx, FRIEND, 3, true));
    expect((await ctx.rideQuery.summary(HOST)).facts.qualifiedReferrals).toBe(0);
    const { poolRide } = await import('../../../support/pool-rides.js');
    await svc.onVerified(await poolRide(ctx, FRIEND, 5_000));
    expect((await ctx.rideQuery.summary(HOST)).facts.qualifiedReferrals).toBe(1);
    expect(await svc.donationReferrer(FRIEND, HOST)).toBeNull(); // the spectator is the referrer
    expect(svc.shareOf(10_000_000, 1000, 0, 500_000_000, false)).toBe(1_000_000);
  });
});
