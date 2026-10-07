import request from 'supertest';
import { newWallet, sign } from '../support/client.js';
import { createHarness, type Harness } from '../support/harness.js';

/* Split deployment: the admin API answers only on admin.<apex> – the nginx site behind basic auth (deploy/nginx/admin.conf.template). nginx sets Host to the
   name it matched, so the Host header is the proof the request came through that site; X-Forwarded-Host is the client's and proves nothing (TRUST_PROXY on). */
const ADMIN = newWallet();

describe('HTTP · the admin API only on admin.<apex>', () => {
  let h: Harness;
  let cookie: string;
  beforeAll(async () => {
    h = await createHarness('memory', { COOKIE_DOMAIN: 'freightchain.fun', CORS_ORIGINS: 'https://freightchain.fun,https://ride.freightchain.fun', TRUST_PROXY: '1', ADMIN_WALLETS: ADMIN.address });
    const { body } = await request(h.server()).post('/api/auth/nonce').send({ wallet: ADMIN.address }).expect(200);
    const res = await request(h.server()).post('/api/auth/verify').send({ wallet: ADMIN.address, signature: sign(ADMIN.kp, body.message) }).expect(200);
    cookie = String(res.headers['set-cookie']).split(';')[0]!;   // Domain=freightchain.fun: a cookie jar on 127.0.0.1 would drop it, so it is sent by hand
  });
  afterAll(() => h.close());

  it('an admin wallet through admin.<apex> gets answers', async () => {
    await request(h.server()).get('/api/admin/overview').set('Host', 'admin.freightchain.fun').set('Cookie', cookie).expect(200);
    await request(h.server()).get('/api/admin/rides').set('Host', 'admin.freightchain.fun:443').set('Cookie', cookie).expect(200);
  });

  it('the same wallet on api.<apex> (or any other host) gets a 404 – also with a forged X-Forwarded-Host', async () => {
    for (const host of ['api.freightchain.fun', 'freightchain.fun', 'ride.freightchain.fun']) {
      await request(h.server()).get('/api/admin/overview').set('Host', host).set('Cookie', cookie).expect(404);
    }
    await request(h.server()).get('/api/admin/overview').set('Host', 'api.freightchain.fun').set('X-Forwarded-Host', 'admin.freightchain.fun').set('Cookie', cookie).expect(404);
  });

  it('the rest of the API still works on admin.<apex> (the page reads /api/me there)', async () => {
    const me = await request(h.server()).get('/api/me').set('Host', 'admin.freightchain.fun').set('Cookie', cookie).expect(200);
    expect(me.body.wallet).toBe(ADMIN.address);
  });
});
