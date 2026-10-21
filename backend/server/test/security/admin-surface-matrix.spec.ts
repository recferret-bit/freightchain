import request from 'supertest';
import { discoverRoutes } from '../contract/discover-routes.js';
import { PrismaService } from '../../src/infrastructure/prisma/prisma.service.js';
import { connectedDatabase } from '../../src/infrastructure/prisma/truncate.js';
import { PUBLIC_ADMIN_ROUTES, isPrivilegedPath } from '../../src/infrastructure/http/guards/privileged.decorator.js';
import { bindClient, newWallet, type Rider } from '../support/client.js';
import { createHarness, type Harness } from '../support/harness.js';

const AGENT1 = 'postgresql://freight:freight_dev_password@127.0.0.1:15433/freightchain_agent1_test';

/* As-built refusal is 404 not_found (detail "not found"), the same body as a missing route — not 401.
   Logout stays behind a session. Only the four nonce/verify routes are public. */
const ADMIN = newWallet();
const MODERATOR = newWallet();
const EDITOR = newWallet();
const PUBLIC = [...PUBLIC_ADMIN_ROUTES].sort();

const concrete = (path: string): string => path.replace(/:([A-Za-z0-9_]+)/g, (_match, name: string) => {
  if (name === 'wallet') return ADMIN.address;
  if (name === 'id' || name === 'revId' || name === 'eventId') return '00000000-0000-4000-8000-000000000001';
  if (name === 'code') return 'WAVE4';
  return 'x';
});

describe('privileged surface matrix', () => {
  let h: Harness;
  const { loginAdmin } = bindClient(() => h);

  beforeAll(async () => {
    h = await createHarness('memory', { ADMIN_WALLETS: ADMIN.address, MODERATOR_WALLETS: MODERATOR.address, EDITOR_WALLETS: EDITOR.address });
  }, 60_000);
  afterAll(() => h?.close());

  it('refuses every privileged route except the four public nonce/verify routes when there is no session', async () => {
    expect(PUBLIC).toEqual([
      'POST /api/admin/auth/nonce',
      'POST /api/admin/auth/verify',
      'POST /api/editor/auth/nonce',
      'POST /api/editor/auth/verify',
    ]);
    const routes = discoverRoutes(h.app).filter((route) => isPrivilegedPath(route.path));
    const keys = routes.map((route) => `${route.method} ${route.path}`);
    expect(keys.length).toBeGreaterThan(40);
    for (const key of PUBLIC) expect(keys, key).toContain(key);
    for (const needle of ['GET /api/admin/overview', 'GET /api/admin/rides', 'POST /api/admin/settings', 'GET /api/editor/me', 'GET /api/editor/mcp/entities', 'POST /api/admin/chat/:eventId/hide']) {
      expect(keys, needle).toContain(needle);
    }
    const misses: string[] = [];
    for (const route of routes) {
      const key = `${route.method} ${route.path}`;
      if (PUBLIC_ADMIN_ROUTES.has(key)) continue;
      const call = request(h.server())[route.method.toLowerCase() as 'get'](concrete(route.path));
      if (route.method !== 'GET') call.send({});
      const res = await call;
      if (res.status !== 404 || res.body?.code !== 'not_found' || res.body?.detail !== 'not found') {
        misses.push(`${key} -> ${res.status} ${String(res.body?.code)} ${String(res.body?.detail)}`);
      }
    }
    expect(misses).toEqual([]);
    const stranger = newWallet();
    expect((await request(h.server()).post('/api/admin/auth/nonce').set('x-fc-admin', '1').send({ wallet: stranger.address })).status).toBe(200);
    expect((await request(h.server()).post('/api/admin/auth/verify').set('x-fc-admin', '1').send({ wallet: stranger.address, signature: 'sig' })).status).toBe(401);
    expect((await request(h.server()).post('/api/editor/auth/nonce').set('x-fc-editor', '1').send({ wallet: EDITOR.address })).status).toBe(200);
    expect((await request(h.server()).post('/api/editor/auth/verify').set('x-fc-editor', '1').send({ wallet: EDITOR.address, signature: 'sig' })).status).toBe(401);
  });

  it('a moderator can read the moderation queue and cannot change settings', async () => {
    const moderator: Rider = await loginAdmin(MODERATOR);
    const admin: Rider = await loginAdmin(ADMIN);
    for (const path of ['/api/admin/rides', '/api/admin/replays', '/api/admin/queue/count', '/api/admin/players']) {
      const res = await moderator.agent.get(path);
      expect(res.status, `${path} ${JSON.stringify(res.body)}`).toBe(200);
    }
    expect((await admin.agent.get('/api/admin/settings')).status).toBe(200);
    for (const hit of [
      () => moderator.agent.post('/api/admin/settings').set('x-fc-admin', '1').send({ key: 'free_on_signup', value: 1, signature: 'sig' }),
      () => moderator.agent.post('/api/admin/settings/challenge').set('x-fc-admin', '1').send({ action: 'setting_update', key: 'free_on_signup', value: 1 }),
    ]) {
      const res = await hit();
      expect(res.status, JSON.stringify(res.body)).toBe(403);
      expect(res.body.code).toBe('insufficient_role');
    }
  });
});

describe('moderator overview', () => {
  let h: Harness;
  const { loginAdmin } = bindClient(() => h);

  beforeAll(async () => {
    if (process.env['TEST_DATABASE_URL'] && process.env['TEST_DATABASE_URL'] !== AGENT1) throw new Error('refusing TEST_DATABASE_URL other than freightchain_agent1_test');
    process.env['TEST_DATABASE_URL'] = AGENT1;
    h = await createHarness('postgres', { ADMIN_WALLETS: ADMIN.address, MODERATOR_WALLETS: MODERATOR.address });
    const name = await connectedDatabase(h.app.get(PrismaService));
    if (name === 'freightchain' || name === 'freightchain_test') throw new Error(`refusing database ${name}`);
    expect(name).toBe('freightchain_agent1_test');
  }, 90_000);
  afterAll(() => h?.close());

  it('a moderator session can read /api/admin/overview', async () => {
    const moderator: Rider = await loginAdmin(MODERATOR);
    const overview = await moderator.agent.get('/api/admin/overview');
    expect(overview.status, JSON.stringify(overview.body)).toBe(200);
    expect(overview.body).toEqual(expect.objectContaining({ underReview: expect.any(Number), undeliveredAlerts: expect.any(Number) }));
  });
});
