/* Shared traffic vehicle definitions, AI presets, trip traffic knobs, and collision constants used by both client/ and server/. */

export const TRAFFIC_SEED_XOR = 0x9e3779b9;
export const TRUCK_FRONT = 3.3;
export const CAB_BACK = 1.6;
export const HITCH = 1.2;
export const TRAILER_BACK = 14.7;
export const TRUCK_HALF_W = 1.25;
export const TRAILER_HALF_W = 1.3;
export const TRAFFIC_MAX = 7;
export const TRAFFIC_GAP = 5;
export const TRAFFIC_CLEAR = 0.5;
export const TRAFFIC_LOOK = 12;
export const TRAFFIC_RUB_GAP = 1.5;
export const CRASH_TRUCK_MASS = 6;
export const CRASH_OVERLAP = 0.4;
export const CRASH_CLOSING = 7;
export const SCRATCH_DMG = 1.5;
export const HOLE_WARN = 110;
export const HORIZON = 10;
export const HOLE_MARGIN = 0.35;

export const CAR_COLORS = [0xb8bcc2, 0x2f4a7a, 0x9a2b2b, 0xe0d8c0, 0x3d5a3a, 0x1e1e22, 0xc9a227];

export const VEHICLES = {
  sedan:     { type: 'sedan',     name: 'car',        len: 4.6, w: 1.85, h: 1.7, mass: 1,   v: [16, 26], rare: 10,  presets: { cruise: 5, slow: 2, tailgate: 2, overtake: 3, weave: 1 } },
  truck:     { type: 'truck',     name: 'truck',      len: 7.5, w: 2.4,  h: 3.4, mass: 1.8, v: [13, 21], rare: 4,   presets: { cruise: 5, slow: 3, tailgate: 1 } },
  bus:       { type: 'bus',       name: 'bus',        len: 12,  w: 2.55, h: 3.3, mass: 2.2, v: [14, 20], rare: 3,   presets: { cruise: 5, slow: 2 } },
  freighter: { type: 'freighter', name: 'freighter',  len: 17,  w: 2.5,  h: 4.0, mass: 3,   v: [13, 20], rare: 4,   presets: { cruise: 6, slow: 3 } },
  police:    { type: 'police',    name: 'police car', len: 4.8, w: 1.9,  h: 1.8, mass: 1.1, v: [22, 30], rare: 2,   presets: { cruise: 2, emergency: 3, tailgate: 1 } },
  medic:     { type: 'medic',     name: 'ambulance',  len: 6.2, w: 2.2,  h: 3.0, mass: 1.5, v: [24, 32], rare: 1.2, presets: { emergency: 1 } },
  fire:      { type: 'fire',      name: 'fire truck', len: 9,   w: 2.5,  h: 3.3, mass: 2.5, v: [22, 30], rare: 1,   presets: { emergency: 1 } },
};
export const TRAFFIC_TYPES = Object.keys(VEHICLES);

export const PRESETS = {
  cruise:    { speed: 1,    T: 1.6 },
  slow:      { speed: 0.6,  T: 1.8 },
  tailgate:  { speed: 1.15, T: 0.3 },
  overtake:  { speed: 1.1,  T: 1.2, over: true },
  weave:     { speed: 0.95, T: 1.5, weave: 1.7 },
  emergency: { speed: 1.05, T: 0.8, over: true, siren: true },
};
export const BEHIND_OK = ['tailgate', 'overtake', 'emergency'];
export const CROSS_OK = ['cruise', 'slow', 'tailgate'];
export const CALM_OK = ['cruise', 'slow'];

export const TRIP_TRAFFIC = {
  classic:   { traffic: 1,   cross: 1,   calm: false, start: 'depot' },
  free:      { traffic: 0.4, cross: 0,   calm: true,  start: 'straight' },
  'free-1':  { traffic: 0.4, cross: 0,   calm: true,  start: 'straight' },
  'free-2':  { traffic: 0.7, cross: 0.7, calm: true,  start: 'depot' },
  'free-3':  { traffic: 1.4, cross: 1.4, calm: false, start: 'depot' },
  'free-g':  { traffic: 0.4, cross: 0,   calm: true,  start: 'straight' },
  'free-1b': { traffic: 0.4, cross: 0,   calm: true,  start: 'straight' },
  'free-2b': { traffic: 0.7, cross: 0.7, calm: true,  start: 'depot' },
  'free-1c': { traffic: 0.4, cross: 0,   calm: true,  start: 'straight' },
  'free-2c': { traffic: 0.8, cross: 0.8, calm: true,  start: 'depot' },
  'free-3b': { traffic: 1.4, cross: 1.4, calm: false, start: 'depot' },
  '1h':      { traffic: 1,   cross: 1,   calm: false, start: 'depot' },
  '4h':      { traffic: 1.4, cross: 1.4, calm: false, start: 'depot' },
  '8h':      { traffic: 1.8, cross: 1.8, calm: false, start: 'depot' },
};
export const tripTrafficFor = trip => TRIP_TRAFFIC[trip ?? 'classic'] ?? TRIP_TRAFFIC.classic;

export const bumpDmg = (def, closing, crashClosing = CRASH_CLOSING) => Math.min(25, 4 * def.mass * (closing / crashClosing) ** 2 + 0.5);

/** Swept continuous collision test along a step [s0..s1, d0..d1]: checks 4 sub-instants against cab + trailer boxes so fast closing speeds never tunnel. */
export function checkTruckTrafficSwept(car, s0, s1, d0, d1, vTruck) {
  const { def } = car;
  const sPrev = car.sPrev ?? car.s, latPrev = car.latPrev ?? car.lat;
  let bestPenS = 0, bestPenL = 0, bestAlpha = 1;
  for (const alpha of [0.25, 0.5, 0.75, 1.0]) {
    const ts = s0 + (s1 - s0) * alpha, td = d0 + (d1 - d0) * alpha;
    const cs = sPrev + (car.s - sPrev) * alpha, cl = latPrev + (car.lat - latPrev) * alpha;
    const cabS0 = ts - CAB_BACK, cabS1 = ts + TRUCK_FRONT, cabL0 = td - TRUCK_HALF_W, cabL1 = td + TRUCK_HALF_W;
    const trlS0 = ts - TRAILER_BACK, trlS1 = ts - HITCH, trlL0 = td - TRAILER_HALF_W, trlL1 = td + TRAILER_HALF_W;
    for (const [pS0, pS1, pL0, pL1] of [[cabS0, cabS1, cabL0, cabL1], [trlS0, trlS1, trlL0, trlL1]]) {
      const ps = Math.min(pS1, cs + def.len / 2) - Math.max(pS0, cs - def.len / 2);
      const pl = Math.min(pL1, cl + def.w / 2) - Math.max(pL0, cl - def.w / 2);
      if (ps > 0 && pl > 0 && ps * pl > bestPenS * bestPenL) { bestPenS = ps; bestPenL = pl; bestAlpha = alpha; }
    }
  }
  if (bestPenS <= 0 || bestPenL <= 0) return null;

  const ts = s0 + (s1 - s0) * bestAlpha, td = d0 + (d1 - d0) * bestAlpha;
  const cs = sPrev + (car.s - sPrev) * bestAlpha, cl = latPrev + (car.lat - latPrev) * bestAlpha;
  const rel = cs - ts, vs = car.dir * car.v;
  const closing = Math.max(0, rel >= 0 ? vTruck - vs : vs - vTruck);
  const frac = bestPenL / Math.min(2.5, def.w);
  const scale = Math.max(0.4, Math.min(2, Math.abs(vs - vTruck) / 10));

  let kind = 'scrape';
  let expectedDamage = SCRATCH_DMG * scale * Math.sqrt(def.mass);
  if (frac >= CRASH_OVERLAP && rel > TRUCK_FRONT / 2 && closing >= CRASH_CLOSING) {
    kind = 'crash'; expectedDamage = 100;
  } else if (frac >= CRASH_OVERLAP && (rel > TRUCK_FRONT / 2 || rel < -TRAILER_BACK + 1)) {
    kind = 'bump'; expectedDamage = bumpDmg(def, closing);
  }
  return { kind, bestAlpha, ts, td, cs, cl, rel, closing, overlapFraction: frac, expectedDamage };
}
