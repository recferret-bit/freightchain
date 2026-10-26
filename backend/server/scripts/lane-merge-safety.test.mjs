import test from 'node:test';
import assert from 'node:assert/strict';
import { laneMergeUnsafe } from './lane-merge-safety.mjs';

const truck = { s: 1000, v: 21, d: 7.2 };
const car = (s, v, lat = 2.4, dir = 1) => ({ s, v, lat, dir, road: { main: true } });

test('refuses the 7.2 to 2.4 merge into a slow car ahead that the move would close on', () => {
  assert.equal(laneMergeUnsafe([car(1060, 8)], truck, 2.4), true);   // 13 m/s closing x ~4.8 s eats the gap
  assert.equal(laneMergeUnsafe([car(1020, 21)], truck, 2.4), true);  // inside the headway even at equal speed
});
test('refuses a car alongside, an oncoming car and a faster car behind', () => {
  assert.equal(laneMergeUnsafe([car(1004, 21)], truck, 2.4), true);
  assert.equal(laneMergeUnsafe([car(1150, 20, -2.4, -1)], { ...truck, d: 2.4 }, -2.4), true);
  assert.equal(laneMergeUnsafe([car(960, 30)], truck, 2.4), true);
});
test('allows a clear lane, a far or faster-ahead car, a slower car behind and cars in other lanes', () => {
  assert.equal(laneMergeUnsafe([], truck, 2.4), false);
  assert.equal(laneMergeUnsafe([car(1200, 18)], truck, 2.4), false);
  assert.equal(laneMergeUnsafe([car(1040, 25)], truck, 2.4), false);
  assert.equal(laneMergeUnsafe([car(940, 15)], truck, 2.4), false);
  assert.equal(laneMergeUnsafe([car(1005, 5, 7.2)], truck, 2.4), false);
  assert.equal(laneMergeUnsafe([{ ...car(1030, 5), road: { main: false } }], truck, 2.4), false);
});
test('a longer move needs more room', () => {
  const c = [car(1070, 14)];
  assert.equal(laneMergeUnsafe(c, truck, 2.4, { moveSeconds: 1 }), false);
  assert.equal(laneMergeUnsafe(c, truck, 2.4, { moveSeconds: 6 }), true);
});
test('stays self-contained when serialized into the browser', () => {
  const copy = new Function(`return (${laneMergeUnsafe.toString()})`)();
  assert.equal(copy([car(1060, 8)], truck, 2.4), true);
  assert.equal(copy([], truck, 2.4), false);
});
