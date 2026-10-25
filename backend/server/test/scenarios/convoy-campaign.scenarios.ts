import { ConvoyService } from '../../src/application/referral/convoy.service.js';
import { AirdropService } from '../../src/application/airdrop/airdrop.service.js';
import { AirdropRepositoryPort } from '../../src/application/airdrop/airdrop.repository.port.js';
import { PlayerRepositoryPort } from '../../src/application/ports/players/player.repository.port.js';
import { RideRepositoryPort } from '../../src/application/ports/rides/ride.repository.port.js';
import { bindClient } from '../support/client.js';
import type { Harness } from '../support/harness.js';
import { airdropProviderScenarios } from './airdrop-provider.scenarios.js';

export function convoyCampaignScenarios(h: () => Harness): void {
  const { login } = bindClient(h);
  beforeEach(() => h().reset());
  airdropProviderScenarios(h);

  it('Convoy activation grants a usable 1h promo exactly once and public privacy masks the wallet', async () => {
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
    expect(board.rows).toEqual([expect.objectContaining({ wallet: null, displayName: 'Anonymous Dispatcher', active: 1, hidden: true })]);
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
}
