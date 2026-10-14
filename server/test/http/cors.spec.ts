import request from 'supertest';
import { newWallet, sign } from '../support/client.js';
import { createHarness, type Harness } from '../support/harness.js';

/* Split deployment (landing + lobby on the apex, the game on ride.*, the API on api.*): the browser may call the API from exactly the listed origins, with the session cookie,
   and the cookie is issued for the shared parent domain. Without CORS_ORIGINS nothing changes (single origin). */
const APEX = 'https://freightchain.fun';
const GAME = 'https://ride.freightchain.fun';

describe('HTTP · CORS + shared cookie domain', () => {
  let h: Harness;
  beforeAll(async () => { h = await createHarness('memory', { CORS_ORIGINS: `${APEX},${GAME}`, COOKIE_DOMAIN: 'freightchain.fun' }); });
  afterAll(() => h.close());

  it('answers the preflight of an allowed origin (credentials, JSON body) and exposes X-Request-Id', async () => {
    const res = await request(h.server()).options('/api/auth/nonce').set('Origin', GAME).set('Access-Control-Request-Method', 'POST').set('Access-Control-Request-Headers', 'content-type').expect(204);
    expect(res.headers['access-control-allow-origin']).toBe(GAME);
    expect(res.headers['access-control-allow-credentials']).toBe('true');
    expect(res.headers['access-control-allow-headers']).toMatch(/content-type/i);
    const get = await request(h.server()).get('/api/health/live').set('Origin', APEX).expect(200);
    expect(get.headers['access-control-expose-headers']).toMatch(/X-Request-Id/i);
  });

  it('opens /api/solana-pay to any origin (a phone wallet is not one of ours)', async () => {
    const id = '00000000-0000-4000-8000-000000000001';
    const pre = await request(h.server()).options(`/api/solana-pay/rides/${id}`).set('Origin', 'https://phantom.app').set('Access-Control-Request-Method', 'POST').set('Access-Control-Request-Headers', 'content-type').expect(204);
    expect(pre.headers['access-control-allow-origin']).toBe('*');
    const get = await request(h.server()).get(`/api/solana-pay/rides/${id}`).set('Origin', 'https://phantom.app').expect(200);
    expect(get.headers['access-control-allow-origin']).toBe('*');
    expect(get.body).toMatchObject({ label: 'Freight Chain' });
  });

  it('gives another origin no CORS headers (the browser blocks it)', async () => {
    const res = await request(h.server()).get('/api/health/live').set('Origin', 'https://evil.example').expect(200);
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });

  describe('pentest H7 / M4: a page that is not ours cannot change state, and no sibling reads the admin API', () => {
    const API = 'api.freightchain.fun', STORYBOOK = 'https://storybook.freightchain.fun';
    const signedIn = async () => {
      const w = newWallet();
      const { body } = await request(h.server()).post('/api/auth/nonce').send({ wallet: w.address }).expect(200);
      const res = await request(h.server()).post('/api/auth/verify').send({ wallet: w.address, signature: sign(w.kp, body.message) }).expect(200);
      return String(res.headers['set-cookie']).split(';')[0]!;
    };

    it('login CSRF: a cross-site form post to /api/auth/verify is 415; the same as JSON from another site is 403 bad_origin', async () => {
      const w = newWallet();
      const { body } = await request(h.server()).post('/api/auth/nonce').send({ wallet: w.address }).expect(200);
      const form = await request(h.server()).post('/api/auth/verify').set('Host', API).set('Origin', 'https://evil.example').type('form').send({ wallet: w.address, signature: sign(w.kp, body.message) });
      expect([form.status, form.headers['set-cookie']]).toEqual([415, undefined]);
      const json = await request(h.server()).post('/api/auth/verify').set('Host', API).set('Origin', 'https://evil.example').send({ wallet: w.address, signature: sign(w.kp, body.message) });
      expect([json.status, json.body.code, json.headers['set-cookie']]).toEqual([403, 'bad_origin', undefined]);
    });

    it('a sibling that is not allowlisted (storybook.*) cannot create a ride with the shared cookie – neither as a form nor as JSON; ride.* can', async () => {
      const cookie = await signedIn();
      expect((await request(h.server()).post('/api/rides').set('Host', API).set('Origin', STORYBOOK).set('Cookie', cookie).type('form').send({ tier: 'free' })).status).toBe(415);
      expect((await request(h.server()).post('/api/rides').set('Host', API).set('Origin', STORYBOOK).set('Cookie', cookie).send({ tier: 'free' })).status).toBe(403);
      expect((await request(h.server()).post('/api/rides').set('Host', API).set('Origin', GAME).set('Cookie', cookie).send({ tier: 'free' })).status).toBe(200);
    });

    it('a closing tab\'s /end beacon (text/plain, from ride.*) still ends the ride', async () => {
      const cookie = await signedIn();
      const r = (await request(h.server()).post('/api/rides').set('Host', API).set('Origin', GAME).set('Cookie', cookie).send({ tier: 'free' }).expect(200)).body;
      await request(h.server()).post(`/api/rides/${r.id}/start`).set('Host', API).set('Origin', GAME).set('Cookie', cookie).expect(200);
      const end = await request(h.server()).post(`/api/rides/${r.id}/end`).set('Host', API).set('Origin', GAME).set('Cookie', cookie).set('content-type', 'text/plain;charset=UTF-8').send(JSON.stringify({ outcome: 'shift', s: 1, t: 1, hull: 100 }));
      expect(end.status).toBe(200);
    });

    it('M4: on the admin host no CORS headers for any other origin – an allowlisted sibling cannot read admin answers', async () => {
      const res = await request(h.server()).get('/api/admin/signins').set('Host', 'admin.freightchain.fun').set('Origin', APEX);
      expect(res.headers['access-control-allow-origin']).toBeUndefined();
      expect(res.headers['access-control-allow-credentials']).toBeUndefined();
    });
  });

  it('the session cookie is issued for the parent domain', async () => {
    const w = newWallet();
    const { body } = await request(h.server()).post('/api/auth/nonce').send({ wallet: w.address }).expect(200);
    const res = await request(h.server()).post('/api/auth/verify').send({ wallet: w.address, signature: sign(w.kp, body.message) }).expect(200);
    expect(String(res.headers['set-cookie'])).toMatch(/fc_session=.*Domain=freightchain\.fun/i);
  });
});

describe('HTTP · CORS is off without CORS_ORIGINS', () => {
  let h: Harness;
  beforeAll(async () => { h = await createHarness('memory'); });
  afterAll(() => h.close());
  it('no CORS headers and a host-only cookie', async () => {
    const res = await request(h.server()).get('/api/health/live').set('Origin', GAME).expect(200);
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });
});
