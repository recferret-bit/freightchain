import { st } from '../../state.js';
import { phone } from '../../phone.js';
import { machine } from '../../minigames/machine.js';
import { nextToll } from '../../../shared/toll.js';
import { pike, syncPike, passPike } from '../../phone/pike-state.js';

/* Runs from the dash thumb. The arm is the stop; driving past it without paying is blocked in physics. */

export function notePike() {
  const gate = st.mode === 'drive' ? nextToll(st.s) : null;
  const line = gate == null ? 0 : gate - 5.5;
  const near = gate != null && st.s > gate - 28 && st.s <= line + 0.4 && st.v < 1.2;
  syncPike(near, gate);
  passPike(st.s);
  const quiet = machine.phase === 'idle' || machine.phase === 'done';
  const show = quiet && pike.at && (pike.phase === 'pay' || pike.phase === 'code') && !phone.badge && phone.notice !== 'GULP';
  if (show) phone.notice = 'PIKE';
  else if (phone.notice === 'PIKE') phone.notice = null;
}
