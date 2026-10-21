import { st } from '../state.js';
import { CFG } from '../config.js';
import { clamp, mulberry32 } from '../util.js';

/* One GULP visit. The phone app and Messages both read this. It is not a server minigame:
   the four digits are a local code for this bay, generated here, shown only in Messages. */

const STOP_GAP = 3;

export const gulp = {
  bay: null, at: false, seen: false, gas: null, fix: false, code: '', typed: '', phase: 'idle', wrong: false,
};

export function resetGulp() {
  gulp.bay = null; gulp.at = false; gulp.seen = false; gulp.gas = null; gulp.fix = false;
  gulp.code = ''; gulp.typed = ''; gulp.phase = 'idle'; gulp.wrong = false;
}

function fresh(bay) {
  gulp.bay = bay; gulp.at = true; gulp.seen = true; gulp.gas = null; gulp.fix = false;
  gulp.code = ''; gulp.typed = ''; gulp.phase = 'pick'; gulp.wrong = false;
}

/** presentS is the bay the truck is alongside, or null. Latch only while stopped. */
export function syncGulp(presentS, stopped) {
  if (presentS != null && stopped) {
    if (gulp.bay == null || Math.abs(gulp.bay - presentS) > STOP_GAP) fresh(presentS);
    else { gulp.at = true; gulp.seen = true; }
    return;
  }
  gulp.at = false;
}

export function toggleGas(which) {
  if (!gulp.at || gulp.phase !== 'pick') return;
  gulp.gas = gulp.gas === which ? null : which;
}

export function toggleFix() {
  if (!gulp.at || gulp.phase !== 'pick') return;
  gulp.fix = !gulp.fix;
}

function digits(bay) {
  const rnd = mulberry32((Math.round(bay * 10) ^ 0x47554c50) >>> 0);
  let s = '';
  for (let i = 0; i < 4; i++) s += String((rnd() * 10) | 0);
  return s;
}

export function sendCode() {
  if (!gulp.at || gulp.phase !== 'pick') return false;
  if (!gulp.gas && !gulp.fix) return false;
  gulp.code = digits(gulp.bay);
  gulp.typed = ''; gulp.wrong = false; gulp.phase = 'code';
  return true;
}

export function pushDigit(d) {
  if (gulp.phase !== 'code' || gulp.typed.length >= 4) return;
  gulp.typed += d; gulp.wrong = false;
}

export function backDigit() {
  if (gulp.phase !== 'code') return;
  gulp.typed = gulp.typed.slice(0, -1); gulp.wrong = false;
}

function fuelBase() {
  const dist = CFG.COMPLETE_DIST > 0 ? CFG.COMPLETE_DIST : 1;
  return 0.85 - 0.45 * clamp(st.s / (dist * 2), 0, 1);
}

export function confirmCode() {
  if (!gulp.at || gulp.phase !== 'code') return false;
  if (gulp.typed.length < 4) return false;
  if (gulp.typed !== gulp.code) { gulp.typed = ''; gulp.wrong = true; return false; }
  const base = fuelBase();
  if (gulp.gas === 'fill') st.tankBonus = 1 - base;
  else if (gulp.gas === 'half') st.tankBonus = Math.min((st.tankBonus || 0) + 0.4, 1 - base);
  if (gulp.fix) { st.mend = 100; st.scratches = []; st.cracks = []; }
  gulp.gas = null; gulp.fix = false; gulp.code = ''; gulp.typed = ''; gulp.wrong = false; gulp.phase = 'done';
  return true;
}
