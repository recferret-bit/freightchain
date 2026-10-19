/* Free training trips on main. Guest sign-in and the weekly ticket are in merged.test.mjs. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { REPO } from '../../harness/dom.mjs';

const src = (rel) => readFileSync(join(REPO, rel), 'utf8');

test('B1-FREE-01 offline guest practice is trip free-g and never a server ride', () => {
  const trips = src('frontend/client/js/trips.js');
  const rules = src('backend/server/src/domain/rides/ride-trip.ts');
  assert.match(trips, /'free-g':/);
  assert.match(trips, /seconds: 120/);
  assert.match(rules, /'free-g' is the retired offline guest run: never stamped on a ride/);
});

test('B1-FREE-02 bare play.html orders EASY; free-g is only the ?sim=1 tool run', () => {
  const game = src('frontend/client/js/ui/game.js');
  const easy = src('frontend/client/js/easy-entry.js');
  const main = src('frontend/client/js/main.js');
  assert.match(easy, /auth\/guest/);
  assert.match(easy, /level: 1/);
  assert.match(main, /beginEasyEntry/);
  assert.match(main, /setTrip\('free-g'\)/);
  assert.match(main, /\?sim=1/);
  assert.match(game, /id="go"/);
  assert.match(game, /START FREE RUN/);
  assert.match(game, /export async function startRide/);
  assert.doesNotMatch(easy + main + game, /offline=1/);
});

test('B1-FREE-03 online training EASY is level 1 trip free-1c', () => {
  const rules = src('backend/server/src/domain/rides/ride-trip.ts');
  assert.match(rules, /1: \{ level: 1, trip: 'free-1c', name: 'EASY'/);
});

test('B1-FREE-04 online training MEDIUM is level 2 trip free-2c', () => {
  const rules = src('backend/server/src/domain/rides/ride-trip.ts');
  assert.match(rules, /2: \{ level: 2, trip: 'free-2c', name: 'MEDIUM'/);
});

test('B1-FREE-05 online training HARD is level 3 trip free-3c and refuses tutorial and assist', () => {
  const rules = src('backend/server/src/domain/rides/ride-trip.ts');
  assert.match(rules, /3: \{ level: 3, trip: 'free-3c', name: 'HARD'.*tutorial: false, assist: false/);
  assert.match(rules, /tutorial_not_allowed/);
  assert.match(rules, /assist_not_allowed/);
});

test('B1-FREE-06 a new wallet is credited free_on_signup (default 10)', () => {
  const settings = src('backend/server/src/domain/settings/game-settings.ts');
  assert.match(settings, /free_on_signup: 10/);
});

test('B1-FREE-07 the daily credit is GrantDailyFreeRidesHandler capped by free_rides_daily_max (default 5)', () => {
  const settings = src('backend/server/src/domain/settings/game-settings.ts');
  const handler = src('backend/server/src/application/use-cases/players/grant-daily-free-rides/grant-daily-free-rides.handler.ts');
  assert.match(settings, /free_rides_daily_max: 5/);
  assert.match(handler, /class GrantDailyFreeRidesHandler/);
});
