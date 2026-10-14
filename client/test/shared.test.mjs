import test from 'node:test';
import assert from 'node:assert/strict';
import * as shared from '../../shared/index.js';
import * as util from '../js/util.js';
import * as state from '../js/state.js';
import * as patterns from '../js/net/patterns.js';
import * as obstacles from '../js/net/obstacles.js';

test('shared library exports identical references to client modules', () => {
  assert.equal(util.mulberry32, shared.mulberry32);
  assert.equal(util.rnd, shared.rnd);
  assert.equal(util.clamp, shared.clamp);
  assert.equal(util.approach, shared.approach);
  assert.equal(state.RATIOS, shared.GEAR_RATIOS);
  assert.equal(state.RATIOS, shared.RATIOS);
  assert.equal(patterns.PATTERNS, shared.PATTERNS);
  assert.equal(patterns.FORK, shared.FORK);
  assert.equal(patterns.DEFAULT_WEIGHTS, shared.DEFAULT_WEIGHTS);
  assert.equal(obstacles.HOLES, shared.HOLES);
  assert.equal(shared.stepLongitudinalPhysics, shared.stepTruckPhysics);
});

test('shared physics, damage, and swept traffic collision functions behave deterministically across edge cases', () => {
  assert.equal(shared.holeDamage(shared.HOLES.sinkhole, 0, 0), 0);
  assert.equal(shared.holeDamage(shared.HOLES.sinkhole, 2.9, 0), 0);
  assert.equal(shared.holeDamage(shared.HOLES.sinkhole, 28, 0), 14);
  assert.ok(Math.abs(shared.holeDamage(shared.HOLES.sinkhole, 28, 1) - 8.4) < 1e-9);

  const step0 = shared.stepTruckPhysics(0, 0, 0, 1, false, 0.1);
  assert.equal(step0.vSim, 0);
  const stepAccel = shared.stepTruckPhysics(10, 1, 0, 4, false, 0.1);
  assert.ok(stepAccel.vSim > 10 && stepAccel.vSim <= 28);
  assert.ok(stepAccel.vMaxPossible >= stepAccel.vSim);

  const carCrash = { def: shared.VEHICLES.sedan, dir: 1, s: 104, sPrev: 103, lat: 2.4, latPrev: 2.4, v: 10 };
  const hit = shared.checkTruckTrafficSwept(carCrash, 99, 101.5, 2.4, 2.4, 25);
  assert.ok(hit);
  assert.equal(hit.kind, 'crash');
  assert.equal(hit.expectedDamage, 100);
  const carScrape = { def: shared.VEHICLES.sedan, dir: 1, s: 102, sPrev: 101, lat: 3.8, latPrev: 3.8, v: 20 };
  const scrape = shared.checkTruckTrafficSwept(carScrape, 100, 101.5, 2.4, 2.4, 22);
  assert.ok(scrape);
  assert.equal(scrape.kind, 'scrape');
  const miss = shared.checkTruckTrafficSwept(carCrash, 99, 101.5, -2.4, -2.4, 25);
  assert.equal(miss, null);
});
