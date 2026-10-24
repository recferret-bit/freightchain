import test from 'node:test';
import assert from 'node:assert/strict';
import { net } from '../js/net/network.js';
import { rollHole, naturalHole, holesIn, holesNear, installPlan, planCovers, plan, placeHole, obstacleSpot, flagHole, flagged, clearHoleCache } from '../js/net/obstacles.js';

/* The driver's local seeded roll matches the server's obstacle plan; eligible replays fetch that plan and fall back to the same roll until it arrives. */
const SEED = 4242;
const road = () => { net.setStyle({}); net.reset(SEED); clearHoleCache(); };
const rolled = (from, to) => { const out = []; for (let ci = Math.floor(from / 32); ci * 32 < to; ci++) { const h = rollHole(ci); if (h) out.push({ id: h.id, ci: h.ci, type: h.type, s: h.s, lat: h.lat }); } return out; };
const dto = (holes, from = 0, to = 6016, seed = SEED) => ({ rideId: 'r', seed, version: 1, from, to, chunk: 32, holes });

test('the server\'s plan is installed for its seed: identical to the local roll → no mismatch, nothing to rebuild', () => {
  road();
  const holes = rolled(0, 6016);
  assert.ok(holes.length > 3);
  assert.deepEqual(installPlan(dto(holes)), []);
  assert.equal(plan.mismatches.length, 0);
  assert.equal(planCovers(100), 6016);
  for (const h of holes) assert.equal(naturalHole(h.ci).s, h.s);
});

test('a plan for another seed is refused; a stretch the plan does not cover falls back to the local roll (and is counted)', () => {
  road();
  assert.equal(installPlan(dto([], 0, 6016, SEED + 1)), null);
  installPlan(dto(rolled(0, 6016)));
  const far = Math.floor(9000 / 32);
  naturalHole(far);
  assert.ok(plan.fallback.has(far));
  assert.equal(planCovers(7000), 7000);
});

test('where the server and the local roll differ, the SERVER wins – counted as a mismatch, and the chunk is reported for a rebuild', () => {
  road();
  const holes = rolled(0, 6016), [first, ...rest] = holes;
  const moved = { ...first, s: first.s + 3 };
  const changed = installPlan(dto([moved, ...rest]));
  assert.deepEqual(changed, [first.ci]);
  assert.deepEqual(plan.mismatches, [first.ci]);
  assert.equal(naturalHole(first.ci).s, moved.s);
  const gone = installPlan(dto(rest, 0, 6016));   // the server has no hole there after all
  assert.deepEqual(gone, [first.ci]);
  assert.equal(naturalHole(first.ci), null);
});

test('a paid hole sits NEXT TO a chunk\'s own hole (never replaces it), and a new one is never put on a chunk that has one', () => {
  road();
  installPlan(dto(rolled(0, 6016)));
  const h = rolled(0, 6016)[0];
  placeHole('pothole', h.s + 5, -2.4, 'live1');
  assert.deepEqual(holesIn(h.ci).map(x => x.id), [h.id, 'live1']);
  assert.ok(holesNear(h.s - 1, h.s + 6).some(x => x.id === h.id));
  const spot = obstacleSpot(h.s - 40);
  assert.ok(spot !== null && naturalHole(Math.floor(spot / 32)) === null);
});

test('a replay flags a hole the truck drove through untouched: once, by its id', () => {
  road();
  assert.equal(flagHole('h120'), 120);
  assert.equal(flagHole('h120'), null);
  assert.equal(flagHole('live7'), null);
  assert.ok(flagged.has('h120'));
});
