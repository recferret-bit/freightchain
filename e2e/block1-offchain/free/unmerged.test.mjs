/* PR #3 (cursor/ten4-tokenomics-6271) was open when this branch was cut. These checks
   lock the absence on main and leave a todo for the behaviour that lands with that PR. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { REPO } from '../../harness/dom.mjs';

const src = (rel) => readFileSync(join(REPO, rel), 'utf8');
const auth = src('server/src/presentation/auth/auth.http.controller.ts');
const settings = src('server/src/domain/settings/game-settings.ts');
const promo = src('server/src/domain/economy/promo.types.ts');
const trips = src('server/src/domain/rides/ride-trip.ts');

test('B1-FREE-10 UNMERGED: main has no POST /api/auth/guest', () => {
  assert.doesNotMatch(auth, /auth\/guest/);
});
test.todo('B1-FREE-10 UNMERGED later: POST /api/auth/guest opens an EASY-only throwaway session');

test('B1-FREE-11 UNMERGED: main has no weekly granted ticket settings', () => {
  assert.doesNotMatch(settings, /weekly_ticket_/);
});
test.todo('B1-FREE-11 UNMERGED later: a weekly granted paid ticket (409 weekly_ticket_spent when already used)');

test('B1-FREE-13 UNMERGED: HARD is still free-3b; free-3c is not a trip id', () => {
  assert.match(trips, /trip: 'free-3b'/);
  assert.doesNotMatch(trips, /free-3c/);
});
test.todo('B1-FREE-13 UNMERGED later: HARD retunes to free-3c ×10 and free-3b stays legacy');

test('B1-PROMO-05 UNMERGED: promo kind ride is not a main effect', () => {
  assert.doesNotMatch(promo, /kind: 'ride'/);
  assert.match(promo, /kind: 'free_rides'/);
});
test.todo('B1-PROMO-05 UNMERGED later: promo kind ride grants a ride and free_rides is retired (promo_retired)');

test('B1-BOARD-01 UNMERGED: main has no GET /api/prize/board', () => {
  const tree = src('server/src/presentation/economy/pools.http.controller.ts');
  assert.doesNotMatch(tree, /prize\/board/);
});
test.todo('B1-BOARD-01 UNMERGED later: ranked prize board GET /api/prize/board');

test('B1-HONK-01 UNMERGED: the token symbol on this tree is still HONK', () => {
  const honk = src('server/src/presentation/honk/honk.http.controller.ts');
  assert.match(honk, /honk/);
  assert.doesNotMatch(honk, /TEN4/);
});
test.todo('B1-HONK-01 UNMERGED later: TEN4 rename, emission and the mint-ledger versus chain check');
