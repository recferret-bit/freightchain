import test from 'node:test';
import assert from 'node:assert/strict';

const { nextToll, tollsBetween, TOLL_FIRST, TOLL_EVERY } = await import('../shared/toll.js');
const { st } = await import('../js/state.js');
const { pike, resetPike, syncPike, passPike, sendPike, pushPike, confirmPike, holdPike } = await import('../js/phone/pike-state.js');

test('toll gates are fixed and the truck is held until the code matches', () => {
  assert.equal(nextToll(0), TOLL_FIRST);
  assert.equal(nextToll(TOLL_FIRST - 1), TOLL_FIRST);
  assert.equal(nextToll(TOLL_FIRST), TOLL_FIRST + TOLL_EVERY);
  assert.deepEqual(tollsBetween(TOLL_FIRST - 20, TOLL_FIRST + 20), [TOLL_FIRST]);
  assert.deepEqual(tollsBetween(0, 32), []);

  resetPike();
  st.mode = 'drive'; st.vel = 10; st.v = 10; st.s = TOLL_FIRST - 2;
  holdPike();
  assert.equal(st.s, TOLL_FIRST - 5.5);
  assert.equal(st.v, 0);

  syncPike(true, TOLL_FIRST);
  assert.equal(pike.phase, 'pay');
  assert.equal(sendPike(), true);
  assert.match(pike.code, /^\d{4}$/);
  const code = pike.code;
  pike.typed = code === '0000' ? '1111' : '0000';
  assert.equal(confirmPike(), false);
  assert.equal(pike.phase, 'code');
  for (const ch of code) pushPike(ch);
  assert.equal(confirmPike(), true);
  assert.equal(pike.phase, 'open');
  assert.equal(pike.paid, TOLL_FIRST);
  st.s = TOLL_FIRST - 1; st.vel = 8; st.v = 8;
  holdPike();
  assert.equal(st.s, TOLL_FIRST - 1);
  passPike(TOLL_FIRST + 30);
  assert.equal(pike.phase, 'idle');
  assert.equal(pike.code, '');
});

test('successive booths each require payment after the map advances to the next gate', () => {
  resetPike();
  for (const gate of [TOLL_FIRST, TOLL_FIRST + TOLL_EVERY, TOLL_FIRST + 2 * TOLL_EVERY]) {
    st.mode = 'drive'; st.s = gate - 2; st.vel = 10; st.v = 10;
    holdPike();
    assert.equal(st.s, gate - 5.5);
    syncPike(true, nextToll(st.s));
    assert.equal(sendPike(), true);
    for (const ch of pike.code) pushPike(ch);
    assert.equal(confirmPike(), true);
    // Match notePike's real update order, including the next-gate pointer at the arm.
    syncPike(false, nextToll(gate));
    passPike(gate);
    assert.equal(pike.phase, 'open');
    syncPike(false, nextToll(gate + 23));
    passPike(gate + 23);
    assert.equal(pike.phase, 'idle');
    assert.equal(pike.paid, gate);
  }
});
