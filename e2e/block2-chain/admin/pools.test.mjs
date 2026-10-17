import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { after, before, describe, test } from 'node:test';
import { called, hashTo, settle } from '../../harness/dom.mjs';
import { REPO } from '../../harness/dom.mjs';
import { openAdmin } from '../../harness/sessions/admin.mjs';

const src = (rel) => readFileSync(join(REPO, rel), 'utf8');

describe('block 2 admin pools tab', { concurrency: 1 }, () => {
  let page;
  before(async () => { page = await openAdmin({ signedIn: true }); });
  after(() => page?.close());

  test('B2-ADMIN-01 POOLS tab loads /api/admin/pools', async () => {
    hashTo(page, 'pools');
    await settle(40);
    assert.ok(called(page.calls, 'GET', '/api/admin/pools').length >= 1);
  });
});

test('B2-ADMIN-02 set_pool_rules is in the program and missing from every admin HTTP controller', () => {
  const lib = src('programs/freightchain-pools/programs/freightchain_pools/src/lib.rs');
  const idl = src('programs/freightchain-pools/idl/freightchain_pools.json');
  assert.match(lib, /pub fn set_pool_rules/);
  assert.match(idl, /set_pool_rules/);
  const controllers = src('server/src/presentation/admin/admin.http.controller.ts') + src('server/src/presentation/admin/admin-promos.http.controller.ts');
  assert.doesNotMatch(controllers, /set_pool_rules|set-pool-rules|pool-rules/);
});

test('B2-ADMIN-03 the operator CLI is server/scripts/pool-admin.mjs set-pool-rules', () => {
  const cli = src('server/scripts/pool-admin.mjs');
  assert.match(cli, /set-pool-rules/);
});

test.todo('B2-ADMIN-04 live set_pool_rules against the local validator (keypair, not a wallet popup) — see M-10');
