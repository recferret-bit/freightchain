import test from 'node:test';
import assert from 'node:assert/strict';
import { CFG } from '../js/config.js';

const B = CFG.BATT;

test('headlights + cab light + heater can never be sustained while driving', () => {
  const maxCharge = B.CHARGE_MIN + B.CHARGE_RPM;   // alternator at the redline
  assert.ok(B.HEAD + B.CAB + B.HEATER > maxCharge, `${B.HEAD + B.CAB + B.HEATER} must exceed the alternator's ${maxCharge}`);
});
test('headlights + heater alone can never be sustained while driving', () => {
  assert.ok(B.HEAD + B.HEATER > B.CHARGE_MIN + B.CHARGE_RPM);
});
test('the engine-off drain is faster than the engine-on one, and resting heals only a little', () => {
  assert.ok(B.OFF_X > 1);
  assert.ok(B.REST > 0 && B.REST > B.KEY_ON * B.OFF_X && B.REST_MAX < B.START + .01 && B.REST_MAX > B.START_MIN);
});
test('a crank that is allowed to start never leaves the battery at or below DEAD', () => {
  assert.ok(B.START_MIN - B.STARTER * 1.4 > B.DEAD, 'raise START_MIN');
  assert.ok(B.CRITICAL > B.START_MIN && B.CRITICAL > B.DEAD);
});
test('the washer tank lasts 100 s of spray', () => {
  assert.ok(1 / CFG.WASH_DRAIN >= 100 - 1e-9);
});
