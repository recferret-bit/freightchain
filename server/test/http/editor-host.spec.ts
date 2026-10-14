import request from 'supertest';
import { newWallet, sign } from '../support/client.js';
import { createHarness, type Harness } from '../support/harness.js';

/* Split deployment: the model viewer lives on storybook.<apex>; nginx proxies ONLY /api/entities/ and /api/editor/ there. The app is the second wall:
   the editor answers only on that host (same-origin POSTs), nothing else of the API answers there (pentest H7), the bundle has its own per-IP budget,
   and EDITOR_IP_ALLOWLIST narrows the editor further. */
const SB = 'storybook.freightchain.fun', SB_ORIGIN = `https://${SB}`, API = 'api.freightchain.fun';
const ED = newWallet();

async function signIn(h: Harness, host = SB) {
  const agent = request.agent(h.server());
  const nonce = await agent.post('/api/editor/auth/nonce').set('Host', host).set('Origin', `https://${host}`).set('x-fc-editor', '1').send({ wallet: ED.address });
  if (nonce.status !== 200) return { agent, status: nonce.status, message: '' };
  const v = await agent.post('/api/editor/auth/verify').set('Host', host).set('Origin', `https://${host}`).set('x-fc-editor', '1').send({ wallet: ED.address, signature: sign(ED.kp, nonce.body.message) });
  return { agent, status: v.status, message: nonce.body.message as string };
}

describe('HTTP · the 3D model API on storybook.<apex>', () => {
  let h: Harness;
  beforeAll(async () => { h = await createHarness('memory', { COOKIE_DOMAIN: 'freightchain.fun', CORS_ORIGINS: 'https://freightchain.fun,https://ride.freightchain.fun', EDITOR_WALLETS: ED.address }); });
  afterAll(() => h.close());
  beforeEach(() => h.reset());

  it('the editor signs in on storybook.<apex> only: the message names that host, the cookie is host-only; api.<apex> is a 404', async () => {
    const ok = await signIn(h);
    expect(ok.status).toBe(200);
    expect(ok.message).toMatch(/^storybook\.freightchain\.fun wants you to sign in/);
    const me = await ok.agent.get('/api/editor/me').set('Host', SB).expect(200);
    expect(me.body.wallet).toBe(ED.address);
    expect((await signIn(h, API)).status).toBe(404);
    await ok.agent.get('/api/editor/me').set('Host', API).expect(404);
  });

  it('another origin cannot change anything there; nothing but the model API answers on that host', async () => {
    const { agent } = await signIn(h);
    await agent.post('/api/editor/auth/logout').set('Host', SB).set('Origin', 'https://evil.example').set('x-fc-editor', '1').expect(403);
    for (const path of ['/api/me', '/api/health/live', '/api/live', '/api/admin/overview']) await request(h.server()).get(path).set('Host', SB).expect(404);
    await request(h.server()).post('/api/auth/nonce').set('Host', SB).set('Origin', SB_ORIGIN).send({ wallet: ED.address }).expect(404);
    await request(h.server()).get('/api/entities/bundle').set('Host', SB).expect(200);
  });
});

describe('HTTP · the bundle\'s own budget', () => {
  it('per IP (THROTTLE_ENTITIES_LIMIT) → 429 problem+json; other routes are not counted in it', async () => {
    const h = await createHarness('memory', { THROTTLE_ENTITIES_LIMIT: '3' });
    try {
      const statuses: number[] = [];
      for (let i = 0; i < 4; i++) statuses.push((await request(h.server()).get('/api/entities/bundle')).status);
      expect(statuses).toEqual([200, 200, 200, 429]);
      await request(h.server()).get('/api/health/live').expect(200);
    } finally { await h.close(); }
  });
});

describe('HTTP · EDITOR_IP_ALLOWLIST', () => {
  let h: Harness;
  afterEach(() => h.close());

  it('an address outside the list gets 404 even with a valid wallet; inside it, the editor works', async () => {
    h = await createHarness('memory', { EDITOR_WALLETS: ED.address, EDITOR_IP_ALLOWLIST: '10.0.0.0/8' });
    expect((await signIn(h, 'localhost')).status).toBe(404);
    await h.close();
    h = await createHarness('memory', { EDITOR_WALLETS: ED.address, EDITOR_IP_ALLOWLIST: '127.0.0.1, ::1' });
    expect((await signIn(h, 'localhost')).status).toBe(200);
  });
});
