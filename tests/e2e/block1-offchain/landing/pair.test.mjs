/* Phone pairing needs a second device. This only locks the claim route the landing calls. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { REPO } from '../../harness/dom.mjs';

test('B1-LAND-27 the landing claims a ?pair= code at POST /api/auth/pair/:code/claim', () => {
  const main = readFileSync(join(REPO, 'frontend/landing/src/main.js'), 'utf8');
  assert.match(main, /auth\/pair\/\$\{pairCode\}\/claim/);
  assert.match(main, /get\('pair'\)/);
});
