import request from 'supertest';
import { newWallet, sign } from '../support/client.js';
import { createHarness, type Harness } from '../support/harness.js';

/* Split deployment: the admin API – the admin sign-in included – answers only on admin.<apex>, the nginx site behind basic auth (deploy/nginx/admin.conf.template).
   nginx sets Host to the name it matched, so the Host header is the proof the request came through that site; X-Forwarded-Host is the client's and proves
   nothing (TRUST_PROXY on). The admin cookie is host-only (no Domain), unlike the player session shared by every subdomain. */
const ADMIN = newWallet();
const ADMIN_HOST = 'admin.freightchain.fun';

describe('HTTP · the admin API only on admin.<apex>', () => {
  let h: Harness;
  let cookie: string;
  const at = (host: string) => ({
    get: (path: string) => request(h.server()).get(path).set('Host', host),
    post: (path: string) => request(h.server()).post(path).set('Host', host).set('x-fc-admin', '1'),
  });
  beforeAll(async () => {
    h = await createHarness('memory', { COOKIE_DOMAIN: 'freightchain.fun', CORS_ORIGINS: 'https://freightchain.fun,https://ride.freightchain.fun', TRUST_PROXY: '1', ADMIN_WALLETS: ADMIN.address });
    const { body } = await at(ADMIN_HOST).post('/api/admin/auth/nonce').send({ wallet: ADMIN.address }).expect(200);
    expect(body.message.split('\n')[0]).toBe(`${ADMIN_HOST} wants you to sign in with your Solana account:`);   // the wallet matches it to the page asking
    const res = await at(ADMIN_HOST).post('/api/admin/auth/verify').send({ wallet: ADMIN.address, signature: sign(ADMIN.kp, body.message) }).expect(200);
    const setCookie = String(res.headers['set-cookie']);
    expect(setCookie).toMatch(/^fc_admin=[^;]+; Path=\/api\/admin; Expires=[^;]+; HttpOnly; SameSite=Strict$/);   // no Domain: admin.<apex> only
    cookie = setCookie.split(';')[0]!;
  });
  afterAll(() => h.close());

  it('the admin session through admin.<apex> gets answers', async () => {
    await at(ADMIN_HOST).get('/api/admin/overview').set('Cookie', cookie).expect(200);
    await at(`${ADMIN_HOST}:443`).get('/api/admin/rides').set('Cookie', cookie).expect(200);
  });

  it('the same session on api.<apex> (or any other host) gets a 404 – also with a forged X-Forwarded-Host; the sign-in too', async () => {
    for (const host of ['api.freightchain.fun', 'freightchain.fun', 'ride.freightchain.fun']) await at(host).get('/api/admin/overview').set('Cookie', cookie).expect(404);
    await at('api.freightchain.fun').get('/api/admin/overview').set('X-Forwarded-Host', ADMIN_HOST).set('Cookie', cookie).expect(404);
    await at('api.freightchain.fun').post('/api/admin/auth/nonce').send({ wallet: ADMIN.address }).expect(404);
  });
});
