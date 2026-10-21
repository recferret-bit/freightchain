import { st } from '../../state.js';
import { phone } from '../../phone.js';
import { machine } from '../../minigames/machine.js';
import { gulp, syncGulp } from '../../phone/gulp-state.js';
import { places } from './state.js';

/* Runs from the dash thumb, after the minigame frame note. A drive-by does not latch. */

const REACH = 80;

export function noteGulp() {
  let present = null, best = Infinity;
  if (st.mode === 'drive') {
    for (const q of places(st.s - REACH, st.s + REACH)) {
      if (q.impl !== 'gulp-bay') continue;
      const d = Math.abs(st.s - q.s), hl = q.hl > 0 ? q.hl : 22;
      if (d <= hl && d < best) { present = q.s; best = d; }
    }
  }
  syncGulp(present, st.mode === 'drive' && st.v < 1.2);
  const quiet = machine.phase === 'idle' || machine.phase === 'done';
  const show = quiet && gulp.at && gulp.phase !== 'done' && !phone.badge;
  if (show) phone.notice = 'GULP';
  else if (phone.notice === 'GULP') phone.notice = null;
}
