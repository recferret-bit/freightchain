import { ConvoyService } from '../../src/application/referral/convoy.service.js';
import { AirdropService } from '../../src/application/airdrop/airdrop.service.js';
import { AirdropRepositoryPort } from '../../src/application/airdrop/airdrop.repository.port.js';
import { PlayerRepositoryPort } from '../../src/application/ports/players/player.repository.port.js';
import { RideRepositoryPort } from '../../src/application/ports/rides/ride.repository.port.js';
import { SettingsRepositoryPort } from '../../src/application/ports/settings/settings.repository.port.js';
import { ConvoyRepositoryPort } from '../../src/application/referral/convoy.repository.port.js';
import { bindClient } from '../support/client.js';
import type { Harness } from '../support/harness.js';
import { airdropProviderScenarios } from './airdrop-provider.scenarios.js';

export function convoyCampaignScenarios(h: () => Harness): void {
  const { login } = bindClient(h);
  beforeEach(() => h().reset());
  airdropProviderScenarios(h);

  it('Convoy activation grants a usable 1h promo exactly once and public privacy omits the wallet', async () => {
    const host = await login(), friend = await login(), viewer = await login();
    const code = (await host.agent.get('/api/referrals').expect(200)).body.code;
    await friend.agent.post('/api/referrals/convoy/bind').send({ code }).expect(200);
    const convoy = h().app.get(ConvoyService);
    const fact = { rideId: 'activation', wallet: friend.address, status: 'completed', verdict: 'verified', trip: 'free-2c' };
    expect((await convoy.onVerifiedRide(fact)).gift.granted).toBe(true);
    expect((await convoy.onVerifiedRide(fact)).gift.granted).toBe(false);
    const order = (await friend.agent.post('/api/rides').send({ tier: '1h' }).expect(200)).body;
    expect(order).toMatchObject({ tier: '1h', status: 'created' });
    const saved = await h().app.get(RideRepositoryPort).findById(order.id as string);
    expect(saved?.isPromo).toBe(true);
    await friend.agent.post(`/api/rides/${order.id}/start`).expect(200);
    await viewer.agent.post('/api/promo/redeem').send({ code: 'SYSTEM-CONVOY-1H' }).expect(409);
    expect((await host.agent.patch('/api/me/privacy').send({ convoyHidden: true }).expect(200)).body).toEqual({ convoyHidden: true, column: 'present' });
    const board = (await viewer.agent.get('/api/referrals/leaderboard').expect(200)).body;
    expect(board.rows).toEqual([]);
    const self = (await host.agent.get('/api/referrals/leaderboard').expect(200)).body.me;
    expect(self.wallet).toBe(host.address);
  });

  it('campaign status preserves the hold and refuses repeat social ownership changes', async () => {
    const rider = await login();
    const svc = h().app.get(AirdropService);
    const repo = h().app.get(AirdropRepositoryPort);
    await svc.recordVerifiedRide(rider.address, 'free-2c');
    // Provider success is a fixture; this scenario proves the HTTP persistence and reward gate only.
    await repo.claimTelegram(rider.address, 'telegram-test');
    await repo.claimX(rider.address, 'x-test');
    const row = (await repo.get(rider.address))!;
    await repo.save({ ...row, telegramMember: true, xAgeOk: true, xFollowersOk: true, xFollows: true, xQuoteOk: true });
    expect((await rider.agent.get('/api/airdrop/status').expect(200)).body).toMatchObject({ rideUnlocked: true, telegram: { bound: true }, x: { bound: true }, claimed: false });
    expect((await rider.agent.post('/api/airdrop/claim').send({}).expect(200)).body.claimed).toBe(false);
    h().clock.advance(48 * 3600);
    const claimed = (await rider.agent.post('/api/airdrop/claim').send({}).expect(200)).body;
    expect(claimed.claimed).toBe(true);
    expect((await rider.agent.post('/api/airdrop/claim').send({}).expect(200)).body.claimedAt).toBe(claimed.claimedAt);
    expect(await repo.claimTelegram(rider.address, 'replacement')).toBe('changed');
    expect((await h().app.get(PlayerRepositoryPort).findByWallet(rider.address))?.trustScore).toBeLessThan(100);
  });

  it('Convoy milestones require ranked paid evidence plus campaign tasks; weekly grants obey trust and the admin setting', async () => {
    const host = await login(), friend = await login();
    const code = (await host.agent.get('/api/referrals').expect(200)).body.code;
    await friend.agent.post('/api/referrals/convoy/bind').send({ code }).expect(200);
    const svc = h().app.get(ConvoyService), repo = h().app.get(ConvoyRepositoryPort);
    const fact = (rideId: string) => ({ rideId, wallet: friend.address, status: 'completed', verdict: 'verified', trip: '1h', tier: '1h', ranked: true, endedAt: h().clock.now() });
    // Seeded verified facts exercise settlement/HTTP views; actual driving is covered separately.
    await svc.onVerifiedRide({ ...fact('activation'), trip: 'free-2c', tier: 'free', ranked: false });
    await svc.onVerifiedRide({ ...fact('low-trust'), weeklyGrant: true });
    const players = h().app.get(PlayerRepositoryPort), player = (await players.findByWallet(friend.address))!;
    player.setTrustScore(100);
    await players.save(player);
    await h().app.get(SettingsRepositoryPort).upsert('referral_count_weekly_grant', 0);
    await svc.onVerifiedRide({ ...fact('disabled-grant'), weeklyGrant: true });
    await h().app.get(SettingsRepositoryPort).upsert('referral_count_weekly_grant', 1);
    await svc.onVerifiedRide({ ...fact('valid-grant'), weeklyGrant: true });
    await svc.onVerifiedRide({ ...fact('promo'), promo: true });
    await svc.onVerifiedRide({ ...fact('unranked'), ranked: false });
    expect((await repo.ridesOf(friend.address)).filter((row) => row.counted).map((row) => row.rideId)).toEqual(['valid-grant']);
    h().clock.advance(7 * 86400);
    const paid = fact('paid-week-two');
    await svc.onVerifiedRide(paid);
    expect((await repo.ledger()).filter((row) => row.unit === 'ten4')).toEqual([]);
    const campaign = h().app.get(AirdropRepositoryPort);
    await campaign.claimTelegram(friend.address, 'tg-convoy');
    await campaign.claimX(friend.address, 'x-convoy');
    await campaign.save({ ...(await campaign.get(friend.address))!, rideOk: true, telegramMember: true, xAgeOk: true, xFollowersOk: true, xFollows: true, xQuoteOk: true });
    await svc.onVerifiedRide(paid);
    expect((await repo.ledger()).filter((row) => row.unit === 'ten4')).toEqual([expect.objectContaining({ kind: 'm1', releasedAt: null })]);
    h().clock.advance(48 * 3600);
    await svc.onVerifiedRide(paid);
    const returning = await login({ kp: friend.kp, address: friend.address });
    expect((await returning.agent.get('/api/referrals/leaderboard').expect(200)).body.rows).toEqual([expect.objectContaining({ wallet: host.address, qualified: 1 })]);
    expect((await repo.ridesOf(friend.address)).find((row) => row.rideId === paid.rideId)?.at).toEqual(paid.endedAt);
  });
}
