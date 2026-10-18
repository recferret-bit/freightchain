import assert from 'node:assert/strict';
import { test } from 'node:test';
import { apiTest, session, signInPlayer } from '../../harness/api.mjs';

async function player() {
  const api = session();
  await signInPlayer(api);
  return api;
}

apiTest(test, 'B1-API-05 POST /api/rides level 1 is the EASY training ride', async () => {
  const api = await player();
  const r = await api.call('/api/rides', { body: { tier: 'free', level: 1, tutorial: true, assist: true } });
  assert.equal(r.status, 200);
  assert.equal(r.json.tier, 'free');
  assert.equal(r.json.level, 1);
  assert.equal(r.json.trip, 'free-1c');
});

apiTest(test, 'B1-API-06 POST /api/rides level 2 is the MEDIUM training ride', async () => {
  const api = await player();
  const r = await api.call('/api/rides', { body: { tier: 'free', level: 2, tutorial: false, assist: false } });
  assert.equal(r.status, 200);
  assert.equal(r.json.level, 2);
});

apiTest(test, 'B1-API-07 POST /api/rides level 3 is the HARD training ride', async () => {
  const api = await player();
  const r = await api.call('/api/rides', { body: { tier: 'free', level: 3, tutorial: false, assist: false } });
  assert.equal(r.status, 200);
  assert.equal(r.json.level, 3);
  assert.equal(r.json.trip, 'free-3c');
});

apiTest(test, 'B1-API-08 HARD with assist is 409 assist_not_allowed', async () => {
  const api = await player();
  const r = await api.call('/api/rides', { body: { tier: 'free', level: 3, assist: true, tutorial: false } });
  assert.equal(r.status, 409);
  assert.equal(r.json.code, 'assist_not_allowed');
});

apiTest(test, 'B1-API-09 HARD with tutorial is 409 tutorial_not_allowed', async () => {
  const api = await player();
  const r = await api.call('/api/rides', { body: { tier: 'free', level: 3, assist: false, tutorial: true } });
  assert.equal(r.status, 409);
  assert.equal(r.json.code, 'tutorial_not_allowed');
});
