import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { REPO } from '../../harness/dom.mjs';

test('B2-HONK-01 the local TEN4 program id is the one the server documents', () => {
  const env = readFileSync(join(REPO, 'backend/server/src/infrastructure/config/env.schema.ts'), 'utf8');
  assert.match(env, /GctCYSHbCnHN8sE1LjUL9cmSpFd5mcVdfaumRcaVWZZx/);
  const lib = readFileSync(join(REPO, 'backend/programs/freightchain_honk/src/lib.rs'), 'utf8');
  assert.match(lib, /declare_id!\("GctCYSHbCnHN8sE1LjUL9cmSpFd5mcVdfaumRcaVWZZx"\)/);
  const constants = readFileSync(join(REPO, 'backend/programs/freightchain_honk/src/constants.rs'), 'utf8');
  assert.match(constants, /TOKEN_SYMBOL: &\[u8\] = b"TEN4"/);
});

test.todo('B2-HONK-02 compare Player honk balance with the chain mint after a local ride (pending; see B2-API-07)');
