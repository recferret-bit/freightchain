import request, { type Response } from 'supertest';
import { bindClient, newWallet, sign } from '../support/client.js';
import { createHarness, type Harness } from '../support/harness.js';

/* Regression checks that do not need Telegram: a foreign wallet still gets a nonce (verify fails),
   the issued session ignores a TTL above 60 minutes, the three cookies carry different aud claims,
   and ADMIN_IP_ALLOWLIST rejects every other address. */
const ADMIN = newWallet();
const EDITOR = newWallet();
const HOUR_S = 60 * 60;
const ALLOWED_IP = '203.0.113.10';
const BLOCKED_IP = '198.51.100.9';

const cookieToken = (res: Response, name: string): string => {
  const raw = res.headers['set-cookie'];
  const lines = (Array.isArray(raw) ? raw : [raw]).filter((line): line is string => typeof line === 'string');
  const line = lines.find((value) => value.startsWith(`${name}=`));
  const token = line?.split(';')[0]?.slice(name.length + 1);
  if (!token) throw new Error(`no ${name} cookie`);
  return token;
};

const claimsOf = (token: string): { aud: string; iat: number; exp: number } => JSON.parse(Buffer.from(token.split('.')[1] ?? '', 'base64url').toString()) as { aud: string; iat: number; exp: number };

describe('admin findings regression', () => {
  describe('dummy nonce, session cap, audiences', () => {
    let h: Harness;
    const { anon } = bindClient(() => h);

    beforeAll(async () => {
      h = await createHarness('memory', {
        ADMIN_WALLETS: ADMIN.address, EDITOR_WALLETS: EDITOR.address,
        ADMIN_SESSION_TTL_MINUTES: '1440', EDITOR_SESSION_TTL_MINUTES: '1440',
        JWT_SECRET: 'p'.repeat(40), ADMIN_JWT_SECRET: 'a'.repeat(40), EDITOR_JWT_SECRET: 'e'.repeat(40),
      });
    }, 60_000);
    afterAll(() => h?.close());

    it('a non-admin wallet gets a dummy nonce of the same shape and verify returns 401', async () => {
      const stranger = newWallet();
      const first = await anon().post('/api/admin/auth/nonce').set('x-fc-admin', '1').send({ wallet: stranger.address }).expect(200);
      const again = await anon().post('/api/admin/auth/nonce').set('x-fc-admin', '1').send({ wallet: stranger.address }).expect(200);
      const admin = await anon().post('/api/admin/auth/nonce').set('x-fc-admin', '1').send({ wallet: ADMIN.address }).expect(200);
      expect(first.body.message).toBe(again.body.message);
      expect(first.body.message).toContain('ADMIN sign-in to Freight Chain');
      expect(String(first.body.message).split('\n').length).toBe(String(admin.body.message).split('\n').length);
      expect(first.body.message).not.toBe(admin.body.message);
      const verify = await anon().post('/api/admin/auth/verify').set('x-fc-admin', '1').send({ wallet: stranger.address, signature: sign(stranger.kp, first.body.message as string) });
      expect(verify.status).toBe(401);
      expect(verify.body.code).toBe('invalid_credentials');
      expect(verify.headers['set-cookie']).toBeUndefined();
    });

    it('caps the admin and editor session at 60 minutes even when the env asks for 1440', async () => {
      const adminNonce = await anon().post('/api/admin/auth/nonce').set('x-fc-admin', '1').send({ wallet: ADMIN.address }).expect(200);
      const adminVerify = await anon().post('/api/admin/auth/verify').set('x-fc-admin', '1').send({ wallet: ADMIN.address, signature: sign(ADMIN.kp, adminNonce.body.message as string) }).expect(200);
      expect(adminVerify.body.expiresAt).toBe(h.clock.ms + HOUR_S * 1000);
      const adminJwt = claimsOf(cookieToken(adminVerify, 'fc_admin'));
      expect(adminJwt.aud).toBe('fc:admin');
      expect(adminJwt.exp - adminJwt.iat).toBe(HOUR_S);

      const editorNonce = await anon().post('/api/editor/auth/nonce').set('x-fc-editor', '1').send({ wallet: EDITOR.address }).expect(200);
      const editorVerify = await anon().post('/api/editor/auth/verify').set('x-fc-editor', '1').send({ wallet: EDITOR.address, signature: sign(EDITOR.kp, editorNonce.body.message as string) }).expect(200);
      expect(editorVerify.body.expiresAt).toBe(h.clock.ms + HOUR_S * 1000);
      const editorJwt = claimsOf(cookieToken(editorVerify, 'fc_editor'));
      expect(editorJwt.aud).toBe('fc:editor');
      expect(editorJwt.exp - editorJwt.iat).toBe(HOUR_S);
    });

    it('player, admin, and editor tokens use different audiences and do not open each other\'s routes', async () => {
      const playerNonce = await anon().post('/api/auth/nonce').send({ wallet: ADMIN.address }).expect(200);
      const playerVerify = await anon().post('/api/auth/verify').send({ wallet: ADMIN.address, signature: sign(ADMIN.kp, playerNonce.body.message as string) }).expect(200);
      const playerJwt = claimsOf(cookieToken(playerVerify, 'fc_session'));
      const adminNonce = await anon().post('/api/admin/auth/nonce').set('x-fc-admin', '1').send({ wallet: ADMIN.address }).expect(200);
      const adminVerify = await anon().post('/api/admin/auth/verify').set('x-fc-admin', '1').send({ wallet: ADMIN.address, signature: sign(ADMIN.kp, adminNonce.body.message as string) }).expect(200);
      const adminToken = cookieToken(adminVerify, 'fc_admin');
      const editorNonce = await anon().post('/api/editor/auth/nonce').set('x-fc-editor', '1').send({ wallet: EDITOR.address }).expect(200);
      const editorVerify = await anon().post('/api/editor/auth/verify').set('x-fc-editor', '1').send({ wallet: EDITOR.address, signature: sign(EDITOR.kp, editorNonce.body.message as string) }).expect(200);
      const editorToken = cookieToken(editorVerify, 'fc_editor');
      expect([playerJwt.aud, claimsOf(adminToken).aud, claimsOf(editorToken).aud]).toEqual(['fc:player', 'fc:admin', 'fc:editor']);
      expect((await request(h.server()).get('/api/me').set('Cookie', `fc_admin=${adminToken}`)).status).toBe(401);
      expect((await request(h.server()).get('/api/admin/overview').set('Cookie', `fc_session=${cookieToken(playerVerify, 'fc_session')}`)).status).toBe(404);
      expect((await request(h.server()).get('/api/admin/overview').set('Cookie', `fc_editor=${editorToken}`)).status).toBe(404);
      expect((await request(h.server()).get('/api/editor/me').set('Cookie', `fc_admin=${adminToken}`)).status).toBe(404);
    });
  });

  describe('ADMIN_IP_ALLOWLIST', () => {
    let h: Harness;

    beforeAll(async () => {
      h = await createHarness('memory', { ADMIN_WALLETS: ADMIN.address, ADMIN_IP_ALLOWLIST: ALLOWED_IP, TRUST_PROXY: '1' });
    }, 60_000);
    afterAll(() => h?.close());

    it('blocks an address outside the list and still answers an allowlisted one', async () => {
      const blocked = await request(h.server()).get('/api/admin/overview').set('X-Forwarded-For', BLOCKED_IP);
      expect(blocked.status).toBe(403);
      expect(blocked.body.code).toBe('ip_not_allowlisted');
      const nonceBlocked = await request(h.server()).post('/api/admin/auth/nonce').set('X-Forwarded-For', BLOCKED_IP).set('x-fc-admin', '1').send({ wallet: ADMIN.address });
      expect(nonceBlocked.status).toBe(403);
      expect(nonceBlocked.body.code).toBe('ip_not_allowlisted');
      const direct = await request(h.server()).get('/api/admin/overview');
      expect(direct.status).toBe(403);
      expect(direct.body.code).toBe('ip_not_allowlisted');
      const allowedNonce = await request(h.server()).post('/api/admin/auth/nonce').set('X-Forwarded-For', ALLOWED_IP).set('x-fc-admin', '1').send({ wallet: ADMIN.address });
      expect(allowedNonce.status).toBe(200);
      const allowedOverview = await request(h.server()).get('/api/admin/overview').set('X-Forwarded-For', ALLOWED_IP);
      expect(allowedOverview.status).toBe(404);
      expect(allowedOverview.body.code).toBe('not_found');
    });
  });
});
