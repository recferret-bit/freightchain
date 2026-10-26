import { ReferralRepositoryPort } from '../../src/application/ports/referral/referral.repository.port.js';
import { ConvoyService } from '../../src/application/referral/convoy.service.js';
import { ConvoyRepositoryPort } from '../../src/application/referral/convoy.repository.port.js';
import { bindClient } from '../support/client.js';
import type { Harness } from '../support/harness.js';

/* Invites: one code per wallet, one referrer ever, bind before a ride starts. Same scenarios on in-memory and PostgreSQL. */
export function referralScenarios(h: () => Harness): void {
  const { anon, login } = bindClient(h);
  beforeEach(() => h().reset());

  const view = async (w: { agent: { get: (p: string) => { expect: (n: number) => Promise<{ body: ReferralView }> } } }) => (await w.agent.get('/api/referrals').expect(200)).body;

  it('a signed-out caller is refused; a wallet gets a code, a gift and one referrer', async () => {
    expect((await anon().get('/api/referrals')).status).toBe(401);
    const host = await login(), friend = await login(), other = await login();
    const mine = await view(host);
    expect(mine).toMatchObject({ capacity: 5, used: 0, pending: 0, available: 5, max: 100, gift: 'convoy', referredBy: null, invites: [] });
    expect(mine.code).toMatch(/^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{8}$/);
    expect((await host.agent.post('/api/referrals/bind').send({ code: mine.code })).body.code).toBe('own_code');
    expect((await friend.agent.post('/api/referrals/bind').send({ code: 'ZZZZZZZZ' })).body.code).toBe('unknown_code');
    expect((await friend.agent.post('/api/referrals/bind').send({ code: 'IIIIIIII' })).status).toBe(400);
    const bound = await friend.agent.post('/api/referrals/bind').send({ code: mine.code.toLowerCase() }).expect(200);
    expect(bound.body.referredBy).toBe(host.address);
    expect((await friend.agent.post('/api/referrals/bind').send({ code: mine.code })).status).toBe(200);
    expect((await friend.agent.post('/api/referrals/bind').send({ code: (await view(other)).code })).body.code).toBe('already_bound');
    expect((await view(host)).invites.map((i) => i.wallet)).toEqual([friend.address]);
    expect((await host.agent.post('/api/referrals/gift').send({ item: 'signal' }).expect(200)).body.gift).toBe('signal');
    expect((await host.agent.post('/api/referrals/gift').send({ item: 'red' })).status).toBe(400);
  });

  it('Convoy progress, held rewards and privacy are scoped to the signed-in wallet', async () => {
    const host = await login(), friend = await login(), other = await login();
    const code = (await view(host)).code;
    await friend.agent.post('/api/referrals/bind').send({ code }).expect(200);
    await h().app.get(ConvoyService).onVerifiedRide({ wallet: friend.address, rideId: 'http-convoy-activation', trip: 'free-2c', status: 'completed', verdict: 'verified' });
    await friend.agent.post('/api/referrals/bind').send({ code }).expect(200);
    const now = h().clock.now();
    await h().app.get(ConvoyRepositoryPort).insertLedger({ id: `convoy:m1:${friend.address}`, kind: 'm1', wallet: host.address, referrer: host.address, referee: friend.address, amount: 100, unit: 'ten4', at: now, dayKey: 'fixture', weekKey: 'fixture', chainState: 'held', releasedAt: null });
    const mine = (await host.agent.get('/api/referrals').expect(200)).body;
    expect(mine.invites[0]).toMatchObject({ status: 'active', promo: 'granted', weeks: 0, m1: false });
    expect(mine.rewards).toEqual([expect.objectContaining({ state: 'held', amount: 100, paidUnits: '0', releaseAt: new Date(now.getTime() + 48 * 3600000).toISOString() })]);
    expect((await other.agent.get('/api/referrals').expect(200)).body.rewards).toEqual([]);
    expect((await friend.agent.get('/api/referrals').expect(200)).body.inbound.status).toBe('active');
    await host.agent.patch('/api/me/privacy').send({ convoyHidden: true }).expect(200);
    expect((await host.agent.get('/api/referrals').expect(200)).body.hidden).toBe(true);
    const board = (await other.agent.get('/api/referrals/leaderboard').expect(200)).body;
    expect(board.rows.some((r: { wallet: string }) => r.wallet === host.address)).toBe(false);
    await host.agent.patch('/api/me/privacy').send({ convoyHidden: false }).expect(200);
    expect((await other.agent.get('/api/referrals/leaderboard').expect(200)).body.rows.some((r: { wallet: string }) => r.wallet === host.address)).toBe(true);
  });

  it('retains historical pending ownership and its deadline without rewriting old records', async () => {
    const host = await login(), friend = await login(), other = await login();
    const repo = h().app.get(ReferralRepositoryPort), now = h().clock.now();
    const old = { referee: friend.address, referrer: host.address, status: 'pending' as const, boundAt: now, expiresAt: new Date(now.getTime() + 14 * 86400000), qualifiedAt: null, rideId: null, freeGranted: false, badgeCounted: false };
    await repo.insertReferral(old);
    expect((await view(friend)).referredBy).toBe(host.address);
    expect((await friend.agent.post('/api/referrals/bind').send({ code: (await view(other)).code })).body.code).toBe('already_bound');
    await friend.agent.post('/api/referrals/bind').send({ code: (await view(host)).code }).expect(200);
    expect((await h().app.get(ConvoyRepositoryPort).getByReferee(friend.address))?.expiresAt).toEqual(new Date(now.getTime() + 72 * 3600000));
    expect(await repo.referralOf(friend.address)).toEqual(old);
  });

  it('an existing driver can bind; pending expires after 72h and may rebind', async () => {
    const host = await login(), friend = await login();
    const { code } = await view(host);
    const id = (await friend.agent.post('/api/rides').send({ tier: 'free' }).expect(200)).body.id as string;
    await friend.agent.post(`/api/rides/${id}/start`).expect(200);
    await friend.agent.post('/api/referrals/bind').send({ code }).expect(200);
    h().clock.advance(72 * 3600 + 1);
    expect((await view(friend)).referredBy).toBeNull();
    await friend.agent.post('/api/referrals/bind').send({ code }).expect(200);
  });
}

interface ReferralView { code: string; referredBy: string | null; invites: { wallet: string }[]; gift: string }
