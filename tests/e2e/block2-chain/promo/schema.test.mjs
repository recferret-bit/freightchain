import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { REPO } from '../../harness/dom.mjs';

test('B2-PROMO-01 a ticket promo is a main effect (pool id + tier + credits)', () => {
  const dto = readFileSync(join(REPO, 'backend/server/src/presentation/admin/dto/admin-promos.dto.ts'), 'utf8');
  assert.match(dto, /kind: z\.literal\('tickets'\)/);
});

test.todo('B2-PROMO-02 redeem a ticket promo into a locally deployed pool (needs chain-init fixtures)');
