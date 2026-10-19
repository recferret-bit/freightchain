import { st } from '../state.js';

/* Explicit finite state machine for ride lifecycle modes ('menu' | 'drive' | 'paused' | 'done') and failure classification. */

export const RIDE_MODES = Object.freeze({
  MENU: 'menu',
  DRIVE: 'drive',
  PAUSED: 'paused',
  DONE: 'done',
});

const VALID_TRANSITIONS = Object.freeze({
  menu: new Set(['drive', 'menu']),
  drive: new Set(['paused', 'done', 'drive']),
  paused: new Set(['drive', 'done', 'menu']),
  done: new Set(['drive', 'menu', 'done']),
});

export const onShift = (mode = st.mode) => mode === RIDE_MODES.DRIVE || mode === RIDE_MODES.PAUSED;
export const canStartRide = (mode = st.mode) => !onShift(mode);
export const canEndRide = (mode = st.mode) => onShift(mode);
export const canPauseRide = (mode = st.mode) => mode === RIDE_MODES.DRIVE;
export const canResumeRide = (mode = st.mode) => mode === RIDE_MODES.PAUSED;

export function transitionRideMode(next, target = st) {
  const cur = target.mode || RIDE_MODES.MENU;
  const allowed = VALID_TRANSITIONS[cur];
  if (allowed && !allowed.has(next)) return false;
  target.mode = next;
  return true;
}

/* Same strings the server stores, so a client "I finished" can be compared with the verdict. Not a completion metric. */
export function failCode(outcome, reason) {
  if (outcome !== 'failed' || typeof reason !== 'string' || !reason) return null;
  if (reason.startsWith('heartbeat lost')) return 'heartbeat_lost';
  if (reason.startsWith('implausible progress (')) return 'implausible_progress';
  if (reason.startsWith('shift complete') || reason.startsWith('shift abandoned') || reason.startsWith('Shift abandoned') || reason === 'replaced by a paid ride') return null;
  if (reason.includes('brakes')) return 'brakes';
  if (reason.includes('blew') || reason.includes('max revs')) return 'engine_blown';
  if (reason.includes('cold')) return 'cold_engine';
  if (reason.includes('hull')) return 'hull';
  if (reason.includes('off the road')) return 'off_road';
  if (reason.includes('collision') || reason.includes('crashed into') || reason.includes('drove into') || reason.includes('ran into')) return 'crash';
  return 'other';
}
