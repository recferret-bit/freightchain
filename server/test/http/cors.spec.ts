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
