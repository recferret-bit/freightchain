import test from 'node:test';
import assert from 'node:assert/strict';
import { createStuckWatchdog, describeStuck } from './normal-drive-stuck.mjs';

const feed = (dog, from, to, v, step = 5) => { let out = null; for (let t = from; t <= to; t += step) out = dog.observe({ t, v, s: 100, mode: 'drive' }) ?? out; return out; };

test('a truck below 1 m/s for 60 game seconds fails; a shorter stop does not', () => {
  assert.equal(feed(createStuckWatchdog(), 0, 55, .01), null);
  assert.match(feed(createStuckWatchdog(), 0, 60, .01), /below 1 m\/s for 60 game s/);
});

test('moving again resets the window, so queues and red lights are not failures', () => {
  const dog = createStuckWatchdog();
  assert.equal(feed(dog, 0, 50, 0), null);
  assert.equal(dog.observe({ t: 55, v: 3, s: 100, mode: 'drive' }), null);
  assert.equal(feed(dog, 60, 110, .2), null);
  assert.ok(feed(dog, 115, 130, .2));
});

test('a crawl above the threshold, other modes and bad samples never count', () => {
  assert.equal(feed(createStuckWatchdog(), 0, 600, 1.2), null);
  const dog = createStuckWatchdog();
  for (let t = 0; t < 200; t += 5) assert.equal(dog.observe({ t, v: 0, s: 1, mode: 'done' }), null);
  assert.equal(dog.observe({ t: NaN, v: 0, s: 1, mode: 'drive' }), null);
});

test('thresholds are configurable', () => {
  assert.ok(feed(createStuckWatchdog({ seconds: 20, minSpeed: 2 }), 0, 25, 1.5));
});

test('the report names the truck, the driver intent, the gate and the nearby cars', () => {
  const report = describeStuck({ s: 16135.3, t: 2683.2, v: .01, hull: 20.1, gear: 1, driver: { want: 0, target: 2.4, extra: 1 }, pike: { paid: 16130, phase: 'open' }, input: { gas: 1 }, cars: Array.from({ length: 20 }, (_, id) => ({ id })) });
  assert.deepEqual(report.truck, { s: 16135.3, t: 2683.2, v: .01, hull: 20.1, gear: 1 });
  assert.deepEqual(report.driver, { want: 0, target: 2.4 });
  assert.deepEqual(report.pike, { paid: 16130, phase: 'open' });
  assert.equal(report.cars.length, 12);
});
