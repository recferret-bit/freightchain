import { ConvoyService } from '../../src/application/referral/convoy.service.js';
import { AirdropService } from '../../src/application/airdrop/airdrop.service.js';
import { AirdropRepositoryPort } from '../../src/application/airdrop/airdrop.repository.port.js';
import { PrismaService } from '../../src/infrastructure/prisma/prisma.service.js';
import { isoWeekKey } from '../../src/application/referral/convoy-rules.js';
import { utcDay } from '../../src/domain/shared/time.js';
import { bindClient } from './client.js';
import type { Harness } from './harness.js';

/** Registered by concurrency.integration.spec.ts, under its database reset hooks. */
export function convoyConcurrencyScenarios(h: () => Harness): void {
  const { login } = bindClient(h);

  it('Convoy concurrent binds cannot exceed five pending invitations or rebind one referee', async () => {
    const host = await login();
    const friends = await Promise.all(Array.from({ length: 8 }, () => login()));
    const svc = h().app.get(ConvoyService);
    const results = await Promise.allSettled(friends.map((friend) => svc.bind(friend.address, host.address)));
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(5);
    const db = h().app.get(PrismaService);
    expect(await db.convoyInvite.count({ where: { referrer: host.address, status: 'pending' } })).toBe(5);
    const extra = await login();
    const outcomes = await Promise.allSettled([svc.bind(extra.address, friends[0]!.address), svc.bind(extra.address, friends[1]!.address)]);
    expect(outcomes.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(await db.convoyInvite.count({ where: { referee: extra.address } })).toBe(1);
  });

  it('Convoy concurrent activations share the last global promo slot and duplicates issue no extra grant', async () => {
    const hostA = await login(), hostB = await login(), a = await login(), b = await login();
    const db = h().app.get(PrismaService);
    const svc = h().app.get(ConvoyService);
    const now = h().clock.now();
    await db.convoyLedger.createMany({ data: Array.from({ length: 499 }, (_, i) => ({ id: `seed-${i}`, kind: 'promo_1h', wallet: `seed-${i}`, referrer: 'seed-host', referee: `seed-${i}`, amount: 1, unit: 'ride', at: now, dayKey: utcDay(now), weekKey: isoWeekKey(now) })) });
    await svc.bind(a.address, hostA.address);
    await svc.bind(b.address, hostB.address);
    const fact = (wallet: string) => ({ rideId: `activation-${wallet}`, wallet, status: 'completed', verdict: 'verified', trip: 'free-2c' });
    const results = await Promise.all([svc.onVerifiedRide(fact(a.address)), svc.onVerifiedRide(fact(b.address))]);
    expect(results.map((r) => r.gift.reason).sort()).toEqual(['global', 'ok']);
    await Promise.all(Array.from({ length: 5 }, () => svc.onVerifiedRide(fact(a.address))));
    expect(await db.convoyLedger.count({ where: { kind: 'promo_1h' } })).toBe(500);
    expect(await db.promoRideGrant.count({ where: { code: 'SYSTEM-CONVOY-1H' } })).toBe(1);
    expect(await db.convoyRide.count()).toBe(2);
  });

  it('late social progress and duplicate ride callbacks create only one milestone under both player locks', async () => {
    const host = await login(), friend = await login();
    const svc = h().app.get(ConvoyService), campaign = h().app.get(AirdropRepositoryPort);
    await h().app.get(PrismaService).player.update({ where: { wallet: host.address }, data: { trustScore: 50 } });
    await svc.bind(friend.address, host.address);
    const fact = { wallet: friend.address, status: 'completed', verdict: 'verified', tier: '1h', ranked: true, trip: '1h' };
    await svc.onVerifiedRide({ ...fact, rideId: 'activation', trip: 'free-2c', tier: 'free', ranked: false });
    await svc.onVerifiedRide({ ...fact, rideId: 'week-one' });
    h().clock.advance(7 * 86400);
    await svc.onVerifiedRide({ ...fact, rideId: 'week-two' });
    await h().app.get(AirdropService).recordVerifiedRide(friend.address, 'free-2c');
    await campaign.claimTelegram(friend.address, 'late-tg');
    await campaign.claimX(friend.address, 'late-x');
    await campaign.save({ ...(await campaign.get(friend.address))!, telegramMember: true, xAgeOk: true, xFollowersOk: true, xFollows: true, xQuoteOk: true });
    await Promise.all([svc.refreshMilestones(friend.address), svc.refreshMilestones(friend.address), svc.onVerifiedRide({ ...fact, rideId: 'week-two' })]);
    const db = h().app.get(PrismaService);
    expect(await db.convoyLedger.count({ where: { kind: 'm1', referee: friend.address } })).toBe(1);
    expect((await db.convoyInvite.findUnique({ where: { referee: friend.address } }))?.status).toBe('qualified');
  });

  it('campaign concurrent final claims retain one claim timestamp after the 48h hold', async () => {
    const rider = await login();
    const svc = h().app.get(AirdropService), repo = h().app.get(AirdropRepositoryPort);
    await svc.recordVerifiedRide(rider.address, 'free-2c');
    await repo.claimTelegram(rider.address, 'tg');
    await repo.claimX(rider.address, 'x');
    const row = (await repo.get(rider.address))!;
    await repo.save({ ...row, telegramMember: true, xAgeOk: true, xFollowersOk: true, xFollows: true, xQuoteOk: true });
    const held = await Promise.all(Array.from({ length: 4 }, () => svc.claim(rider.address)));
    expect(held.every((r) => !r.claimed)).toBe(true);
    h().clock.advance(48 * 3600);
    const claimed = await Promise.all(Array.from({ length: 4 }, () => svc.claim(rider.address)));
    expect(claimed.every((r) => r.claimed)).toBe(true);
    expect(new Set(claimed.map((r) => r.claimedAt)).size).toBe(1);
    expect(await h().app.get(PrismaService).airdropClaim.count()).toBe(1);
  });
}
