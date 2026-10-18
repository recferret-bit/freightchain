import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { REPO } from '../../harness/dom.mjs';

test('B2-FREE-01 a paid ticket is a fourth path, not one of the three free paths', () => {
  const rules = readFileSync(join(REPO, 'server/src/domain/rides/ride-trip.ts'), 'utf8');
  assert.match(rules, /free-g/);
  assert.match(rules, /free-1c/);
  assert.match(rules, /free-3c/);
  assert.match(rules, /free-3b/);
  assert.match(rules, /'1h': '1h'/);
});
