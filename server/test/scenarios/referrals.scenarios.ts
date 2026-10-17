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
    expect(mine).toMatchObject({ capacity: 3, used: 0, pending: 0, available: 3, max: 30, gift: 'convoy', referredBy: null, invites: [] });
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

  it('a wallet that has started a ride cannot bind', async () => {
    const host = await login(), friend = await login();
    const { code } = await view(host);
    const id = (await friend.agent.post('/api/rides').send({ tier: 'free' }).expect(200)).body.id as string;
    await friend.agent.post(`/api/rides/${id}/start`).expect(200);
    expect((await friend.agent.post('/api/referrals/bind').send({ code })).body.code).toBe('ride_started');
  });
}

interface ReferralView { code: string; referredBy: string | null; invites: { wallet: string }[]; gift: string }
