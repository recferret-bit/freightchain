import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { CHECKS, STATUSES } from './catalog.mjs';
import { REPO } from './harness/dom.mjs';

const plan = readFileSync(join(REPO, 'docs/testing/E2E_PLAN.md'), 'utf8');
const manual = readFileSync(join(REPO, 'docs/testing/MANUAL_TESTS.md'), 'utf8');

test('catalog ids are unique and every id is in the plan', () => {
  const ids = CHECKS.map((c) => c.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const id of ids) assert.ok(plan.includes(id), `plan missing ${id}`);
});

test('every check points at a real test file or the manual log', () => {
  for (const c of CHECKS) {
    assert.ok(STATUSES.includes(c.status), `${c.id} status ${c.status}`);
    if (c.status === 'manual') {
      assert.ok(manual.includes(c.id), `manual log missing ${c.id}`);
      continue;
    }
    const file = join(REPO, c.file);
    assert.ok(existsSync(file), `${c.id} missing ${c.file}`);
    assert.ok(readFileSync(file, 'utf8').includes(c.id), `${c.file} missing ${c.id}`);
  }
});
