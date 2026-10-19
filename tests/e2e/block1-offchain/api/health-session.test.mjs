import assert from 'node:assert/strict';
import { test } from 'node:test';
import { apiTest, session, signInPlayer } from '../../harness/api.mjs';

apiTest(test, 'B1-API-01 GET /api/health/live', async () => {
  const api = session();
  const r = await api.call('/api/health/live');
  assert.equal(r.status, 200);
});

apiTest(test, 'B1-API-02 GET /api/health/ready answers the database', async () => {
  const api = session();
  const r = await api.call('/api/health/ready');
  assert.equal(r.status, 200);
});

apiTest(test, 'B1-API-03 a local keypair signs the nonce and receives a session', async () => {
  const api = session();
  const me = await signInPlayer(api);
  assert.equal(me.me.wallet, me.wallet);
  assert.ok(api.cookie().includes('fc_session'));
});

apiTest(test, 'B1-API-04 GET /api/me shows the signup free-ride credit', async () => {
  const api = session();
  await signInPlayer(api);
  const r = await api.call('/api/me');
  assert.equal(r.status, 200);
  assert.equal(r.json.freeRides, 10);
});

apiTest(test, 'B1-API-10 transfer mode keeps paid tiers unavailable and HONK off-chain', async () => {
  const api = session();
  const tiers = await api.call('/api/tiers');
  assert.equal(tiers.status, 200);
  const free = tiers.json.tiers.find((t) => t.id === 'free');
  const hour = tiers.json.tiers.find((t) => t.id === '1h');
  assert.equal(free.available, true);
  assert.equal(hour.available, false);
  await signInPlayer(api);
  const honk = await api.call('/api/honk');
  assert.equal(honk.status, 200);
  assert.equal(honk.json.chain, null);
});
