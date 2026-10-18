import assert from 'node:assert/strict';
import { test } from 'node:test';
import { apiTest, devAdmin, session, signInAdmin } from '../../harness/api.mjs';

apiTest(test, 'B1-API-12 the dev admin keypair opens an admin session', async () => {
  const api = session();
  await signInAdmin(api, devAdmin());
  assert.ok(api.cookie().includes('fc_admin'));
});

apiTest(test, 'B1-API-13 GET /api/admin/overview is the signed-in admin home', async () => {
  const api = session();
  await signInAdmin(api, devAdmin());
  const r = await api.call('/api/admin/overview');
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(typeof r.json.players, 'number');
});

apiTest(test, 'B1-API-14 GET /api/admin/settings lists the runtime knobs', async () => {
  const api = session();
  await signInAdmin(api, devAdmin());
  const r = await api.call('/api/admin/settings');
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.match(JSON.stringify(r.json), /free_on_signup|freeOnSignup/);
});
