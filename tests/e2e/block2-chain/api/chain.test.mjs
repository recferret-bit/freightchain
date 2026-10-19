import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { apiTest, chainTest, session, signInPlayer, SOLANA } from '../../harness/api.mjs';
import { REPO } from '../../harness/dom.mjs';

const POOL = '8No42h2QXb9opgp3pJfNXL2o77o288SsF8o7CwJGCA1p';
const HONK = 'GctCYSHbCnHN8sE1LjUL9cmSpFd5mcVdfaumRcaVWZZx';

apiTest(test, 'B2-API-01 the program-mode server is live', async () => {
  const r = await session().call('/api/health/live');
  assert.equal(r.status, 200);
});

apiTest(test, 'B2-API-02 GET /api/honk reports the local program id', async () => {
  const api = session();
  await signInPlayer(api);
  const r = await api.call('/api/honk');
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(r.json.chain?.programId, HONK);
});

apiTest(test, 'B2-API-03 GET /api/chain/fees answers', async () => {
  const r = await session().call('/api/chain/fees');
  assert.equal(r.status, 200, JSON.stringify(r.json));
});

apiTest(test, 'B2-API-04 tiers still list free, 1h, 4h and 8h', async () => {
  const r = await session().call('/api/tiers');
  assert.equal(r.status, 200);
  const ids = r.json.tiers.map((t) => t.id);
  assert.deepEqual(ids.filter((id) => ['free', '1h', '4h', '8h'].includes(id)).sort(), ['1h', '4h', '8h', 'free']);
});

test('B2-POOL-01 the escrow program id in the IDL is the pinned one', () => {
  const idl = JSON.parse(readFileSync(join(REPO, 'backend/programs/idl/freightchain_pools.json'), 'utf8'));
  assert.equal(idl.address, POOL);
});

test('B2-POOL-02 the IDL carries set_pool_rules', () => {
  const idl = readFileSync(join(REPO, 'backend/programs/idl/freightchain_pools.json'), 'utf8');
  assert.match(idl, /set_pool_rules/);
});

chainTest(test, 'B2-API-05 the local validator is healthy for a later ticket buy', async () => {
  const r = await fetch(SOLANA, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'getHealth' }),
  });
  const body = await r.json();
  assert.equal(body.result, 'ok');
});

test.todo('B2-API-06 buy a paid ticket, finish a ride, settle and pay winners — reuse server/scripts/e2e-localnet.mjs and e2e-localnet-payout.mjs (Chrome); a code-level Merkle payout is not reimplemented here');

test.todo('B2-API-07 TEN4 mint on the local program matches the PostgreSQL ledger — reuse .claude/skills/honk-suite (Chrome + validator)');
