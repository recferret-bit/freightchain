import { bindClient } from '../support/client.js';
import { createHarness, type Harness } from '../support/harness.js';

/* The throttlers are really wired: past a budget a request is a 429 problem+json. A signed-in rider has a budget of their OWN (by verified session),
   so riders behind one NAT / proxy IP don't starve each other; /api/auth/* has a stricter budget per IP; health is never limited. */
describe('rate limiting', () => {
  let harness: Harness;
  const { anon, login } = bindClient(() => harness);
  afterEach(() => harness.close());

  it('answers 429 rate_limited as problem+json once an anonymous budget is spent', async () => {
    harness = await createHarness('memory', { THROTTLE_LIMIT: '3' });
    for (let i = 0; i < 3; i++) await anon().get('/api/tiers').expect(200);
    const res = await anon().get('/api/tiers').set('x-request-id', 'client-req-0003').expect(429);
    expect(res.headers['content-type']).toMatch(/application\/problem\+json/);
    expect(res.body).toMatchObject({ type: '/problems/rate_limited', status: 429, code: 'rate_limited', requestId: 'client-req-0003' });
    await anon().get('/api/health/live').expect(200); // never limited
  });

  it('signed-in riders on one IP each get their own budget', async () => {
    harness = await createHarness('memory', { THROTTLE_LIMIT: '6' });
    const a = await login(), b = await login();
    for (let i = 0; i < 6; i++) await a.agent.get('/api/me').expect(200);
    await a.agent.get('/api/me').expect(429);
    for (let i = 0; i < 6; i++) await b.agent.get('/api/me').expect(200); // b is not starved by a
    // (budgets are per route AND per tracker – the @nestjs/throttler key – so anonymous calls elsewhere have their own)
    for (let i = 0; i < 6; i++) await anon().get('/api/tiers').expect(200);
    await anon().get('/api/tiers').expect(429);
  });

  it('sign-in has its own, stricter budget (THROTTLE_AUTH_LIMIT) – from the environment, like everything else', async () => {
    harness = await createHarness('memory', { THROTTLE_AUTH_LIMIT: '2' });
    const wallet = (await import('../support/client.js')).newWallet().address;
    await anon().post('/api/auth/nonce').send({ wallet }).expect(200);
    await anon().post('/api/auth/nonce').send({ wallet }).expect(200);
    await anon().post('/api/auth/nonce').send({ wallet }).expect(429);
    await anon().get('/api/tiers').expect(200); // other routes are unaffected
  });

  it('code guessing has its own budget per IP (THROTTLE_PROMO_LIMIT): fresh wallets do not reset it, other routes are unaffected', async () => {
    harness = await createHarness('memory', { THROTTLE_PROMO_LIMIT: '4' });
    const riders = [await login(), await login(), await login()];
    for (let i = 0; i < 4; i++) await riders[i % 3].agent.post('/api/promo/redeem').send({ code: `GUESS${i}` }).expect(404);
    const res = await riders[2].agent.post('/api/promo/redeem').send({ code: 'GUESS9' }).expect(429); // a different wallet, the same machine
    expect(res.body).toMatchObject({ code: 'rate_limited' });
    await riders[0].agent.get('/api/me').expect(200);
    await riders[0].agent.get('/api/promo/mine').expect(200);
  });
});
