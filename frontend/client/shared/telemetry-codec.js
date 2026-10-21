import { SHADOW_STEP_DT, stepAt30Hz } from './physics.js';

/** Named v2.1 streams. Each value is a deflate-raw payload (base64 at the HTTP boundary). */
export const NAMED_STREAMS = ['inp', 'clk', 'chk', 'mg', 'env'];

export const STEP_30_DT = SHADOW_STEP_DT;

/** Require every named stream. Returns the same object. Absent names are a shape error, not a hash. */
export function requireNamedStreams(named) {
  if (!named || typeof named !== 'object') throw new Error('named streams missing');
  for (const key of NAMED_STREAMS) {
    if (typeof named[key] !== 'string' || named[key].length === 0) throw new Error(`named stream ${key} missing`);
  }
  return named;
}

const blankLongitudinal = () => ({ v: 0, gear: 1, gas: 0, brake: 0, clutch: 0, rpm: 800, engineOn: true, park: false, rev: false });

/** Apply inp events whose tick has arrived, then one 1/30 s step. Does not mutate `state` or `inp`. */
function stepOne(state, inp, tick) {
  let next = state;
  for (const event of inp) {
    if (event.tick !== tick) continue;
    next = { ...next, gas: event.gas ?? next.gas, brake: event.brake ?? next.brake, gear: event.gear ?? next.gear };
  }
  return stepAt30Hz(next);
}

/**
 * Step `ticks` times at dt = 1/30 from `inp` ({ tick, gas, brake, gear }).
 * The same function runs on the client and the server. Tick 108000 is one hour.
 */
export function stepInpAt30Hz(initial, inp, ticks) {
  let state = { ...blankLongitudinal(), ...initial };
  const events = inp ?? [];
  for (let tick = 0; tick < ticks; tick++) state = stepOne(state, events, tick);
  return state;
}

/** Continue a batch re-sim. `inp` ticks are absolute. Steps [fromTick, toTick). */
export function continueInpAt30Hz(state, inp, fromTick, toTick) {
  let next = { ...state };
  const events = inp ?? [];
  for (let tick = fromTick; tick < toTick; tick++) next = stepOne(next, events, tick);
  return next;
}

/** FNV-1a over the sorted ids. The client's worldDigest32 and the server's must use this. */
export function worldDigest32(ids) {
  let hash = 0x811c9dc5;
  for (const id of [...ids].map(String).sort()) {
    for (let i = 0; i < id.length; i++) {
      hash ^= id.charCodeAt(i);
      hash = Math.imul(hash, 0x01000193);
    }
    hash ^= 0xff;
  }
  return hash >>> 0;
}

/**
 * points are { tSec, client, server } in order.
 * ≥ 3 mismatches in a row spanning ≥ 10 s reject. Any shorter mismatch flags.
 */
export function judgeWorldDigest(points) {
  let run = 0;
  let runStart = 0;
  let reject = false;
  let flagged = false;
  for (const point of points) {
    if (point.client !== point.server) {
      if (run === 0) runStart = point.tSec;
      run += 1;
      flagged = true;
      if (run >= 3 && point.tSec - runStart >= 10) reject = true;
    } else run = 0;
  }
  if (reject) return 'reject';
  if (flagged) return 'flag';
  return 'ok';
}
