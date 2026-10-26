import { st } from '../state.js';
import { mulberry32 } from '../util.js';
import { nextToll } from '../../shared/toll.js';

/* One PIKE booth. The four digits are a local code, shown only in Messages. Not a server minigame. */

export const pike = {
  gate: null, at: false, paid: null, code: '', typed: '', phase: 'idle', wrong: false,
};

export function resetPike() {
  pike.gate = null; pike.at = false; pike.paid = null; pike.code = ''; pike.typed = ''; pike.phase = 'idle'; pike.wrong = false;
}

function digits(gate) {
  const rnd = mulberry32((Math.round(gate) ^ 0x50494b45) >>> 0);
  let s = '';
  for (let i = 0; i < 4; i++) s += String((rnd() * 10) | 0);
  return s;
}

/** at = stopped at this gate's arm. A paid gate stays open until the truck is through. */
export function syncPike(at, gate) {
  pike.gate = gate;
  if (pike.phase === 'open' && pike.paid === gate) { pike.at = at; return; }
  if (pike.paid === gate) { pike.at = false; return; }
  pike.at = at;
  if (at && pike.phase === 'idle') pike.phase = 'pay';
}

export function passPike(s) {
  // The map already points gate at the next booth; clear against the one actually paid.
  if (pike.phase === 'open' && pike.paid != null && s > pike.paid + 22) {
    pike.phase = 'idle'; pike.code = ''; pike.typed = ''; pike.at = false; pike.wrong = false;
  }
}

export function sendPike() {
  if (!pike.at || pike.phase !== 'pay' || pike.gate == null) return false;
  pike.code = digits(pike.gate); pike.typed = ''; pike.wrong = false; pike.phase = 'code';
  return true;
}

export function pushPike(d) {
  if (pike.phase !== 'code' || pike.typed.length >= 4) return;
  pike.typed += d; pike.wrong = false;
}

export function backPike() {
  if (pike.phase !== 'code') return;
  pike.typed = pike.typed.slice(0, -1); pike.wrong = false;
}

export function confirmPike() {
  if (!pike.at || pike.phase !== 'code' || pike.typed.length < 4) return false;
  if (pike.typed !== pike.code) { pike.typed = ''; pike.wrong = true; return false; }
  pike.paid = pike.gate; pike.code = ''; pike.typed = ''; pike.wrong = false; pike.phase = 'open';
  return true;
}

/** The arm holds the truck until this gate is paid. The eye stops short of the arm. */
export function holdPike() {
  if (st.mode !== 'drive' || st.vel < -0.05) return;
  const gate = nextToll(st.s);
  if (pike.paid === gate) return;
  const line = gate - 5.5;
  if (st.s > line && st.s < gate + 4) { st.s = line; st.v = 0; st.vel = 0; }
}
