import { CFG } from './config.js';
import { clamp } from './util.js';
import { RATIOS } from '../shared/physics.js';

/* Single mutable truck/ride state `st`, raw key state `input`, and sprung gauge display values `disp`. */

export { RATIOS };   // 7 forward gears, geometric ×1.42 (spread 8.2:1; was 3:1, so 5th could pull from a crawl). An upshift at 2500 rpm lands ≈ 1750 (peak torque); top gear unchanged = same top speed.
                                                                       // Each gear's useful range (km/h, 1000–2500 rpm): 1st 5–14 · 2nd 7–20 · 3rd 10–28 · 4th 14–40 · 5th 20–57 · 6th 28–80 · 7th 40–100
export const MAX_GEAR = RATIOS.length - 1;
export { REV_RATIO, REDLINE } from '../shared/physics.js';                // gear -1 (R)
export const K_RPM = 2400 / (30 * 0.75);     // wheel rpm per (m/s · ratio)
export const IDLE = 700, STALL_RPM = 450;
/* Every per-ride field and its start value: the initial `st` below and resetRide() (ui/game.js) both use it, so a new field is added in ONE place.
   The varying ones are passed in: engine/rpm (CFG.START_ENGINE_OFF), engine temperature (ambient), steering pull side (ui/game.js sets it from the road seed). */
export const rideStart = ({ rpm, engineOn, temp, pull }) => ({ s: 0, d: 2.4, psi: 0, v: 0, gear: 0, rpm, freeRpm: IDLE, engineOn, batt: CFG.BATT.START, battDead: false, park: true,   // the truck starts parked: release the brake (B / PARK) before moving
  fight: false, blownWhy: null, stallT: 0, noStall: 0, ign: null, keyOn: false, test: 1, rumble: 0, air: 0.2, temp, heater: false, heatEff: 0, cooler: false, coolEff: 0, coldT: 0, strain: 0, brakeT: 0, _brakeWarned: false, blown: false, _coldWarned: false, tyaw: 0, vel: 0, rev: false, off: false, complete: false, reds: 0, hull: 100, mend: null, tankBonus: 0, dmg: { holes: 0, vehicles: 0, props: 0, cold: 0, other: 0 }, crashV: 0, crashB: 0, crash: 0, flash: 0, pull, cracks: [], scratches: [], wash: 1, washing: false, clutch: 0, gas: 0, brake: 0, steer: 0, t: 0, offT: 0, bugs: [], bugT: 4, grind: 0, jolt: 0, overrev: false });
export const st = {
  mode: 'menu', watch: false, watchCam: 'cabin',   // watch: a spectator's replay. watchCam is cabin | chase | hood (replay only)
  slip: true, lug: 0, stall: 0, stalled: false, ste: 0, pitch: 0, roll: 0, pitchV: 0, rollV: 0,   // not reset per ride: they settle on their own (sim/physics.js)
  ...rideStart({ rpm: 0, engineOn: false, temp: 20, pull: 1 }),
};
/* day/night: `night` = the chosen mode, `k` = fade 0 (day)..1 (night, lerped by world/daynight.js), `head` = headlights, `hk` = their fade, `cab` = cab lamp, `blind` = dazzle from oncoming headlights 0..1 (bx/by = their screen position). `onChange` lets the menu cards follow the N key. */
export const dn = { night: false, k: 0, t: 12, scale: 20, run: true, phase: 'day', morning: true, head: true, hk: 1, cab: false, blind: 0, hood: 0, bx: .5, by: .4, onChange: null };
/* route weather (set by selectTheme from the theme's `weather`): ambient °C and snowfall 0..1; the engine/glass read it from here, so sim/ never imports the scene */
export const weather = { ambient: 25, snow: 0, grime: '176,146,104' };   // grime = windscreen dust colour 'r,g,b'
export const input = { gas: 0, brake: 0, left: 0, right: 0, clutch: 0, wash: 0 };
/* gauge needles are sprung toward their targets so they sweep instead of snapping */
export const disp = { v: 0, rpm: 0, air: 0.2, oil: 0, temp: 0.35, fuel: 0.85, volt: 0.56, h2o: 1, vel: { h2o: 0, v: 0, rpm: 0, air: 0, oil: 0, temp: 0, fuel: 0, volt: 0 } };
export function resetDisp() { Object.assign(disp, { v: 0, rpm: 0, air: 0.2, oil: 0, temp: 0, fuel: 0.85, volt: 0.56, h2o: 1 }); for (const k in disp.vel) disp.vel[k] = 0; }
function spring(key, target, dt) { const vel = disp.vel; vel[key] += ((target - disp[key]) * 120 - vel[key] * 16) * dt; disp[key] += vel[key] * dt; }
/* engine temperature (st.temp, °C) -> TEMP dial 0..1, and how cold the engine is: 1 at/below CFG.ENGINE_COLD .. 0 at/above CFG.ENGINE_WARM */
const tempGauge = t => clamp((t - CFG.TEMP_LO) / (CFG.TEMP_HI - CFG.TEMP_LO), 0, 1);
export const brakeEff = () => 1 - CFG.BRAKE_FADE * clamp((st.brakeT - CFG.BRAKE_FADE_FROM) / (1 - CFG.BRAKE_FADE_FROM), 0, 1);   // 1 = cold brakes, falls as they overheat
/* Recorded hull stays monotonic for the judge. `mend` is how the truck feels after bodywork: null follows hull. */
export const driveHull = () => (st.mend == null ? st.hull : st.mend);
export function chipHull(loss) { st.hull = Math.max(0, st.hull - loss); if (st.mend != null) st.mend = Math.max(0, st.mend - loss); }
export function wreckHull() { st.hull = 0; if (st.mend != null) st.mend = 0; }
export const coldK = () => clamp((CFG.ENGINE_WARM - st.temp) / (CFG.ENGINE_WARM - CFG.ENGINE_COLD), 0, 1);
/* key position -> power: OFF = every gauge/lamp/display dead; ON (engine off) = instruments alive; START = cranking. `st.test` = 0..1 self-test after turning the key to ON */
export const powered = () => st.engineOn || st.keyOn || !!st.ign;
const testT = () => st.ign && st.ign.t < 1.0 ? st.ign.t : st.test < 1 ? st.test : -1;
export const bulbCheck = () => testT() >= 0;
export function updateDisp(dt) {
  if (st.test < 1) st.test += dt;
  const ign = st.ign, cranking = ign && ign.t >= 1.0, pw = powered(), tt = testT();
  const sweep = tt >= 0 ? (tt < .45 ? tt / .45 : 1 - (tt - .45) / .55) : 0;   // key-on gauge self-test sweep
  const prog = clamp(st.s / (CFG.COMPLETE_DIST * 2), 0, 1);   // fuel: the tank lasts about two shifts; a GULP fill adds tankBonus
  const fuel = clamp(0.85 - 0.45 * prog + st.tankBonus, 0, 1);
  spring('v', Math.max(st.v * 3.6, sweep * 120), dt);
  spring('rpm', Math.max(st.rpm, sweep * 3000), dt);
  spring('air', Math.max(pw ? st.air : 0, sweep), dt);
  spring('oil', Math.max(st.engineOn ? .3 + st.rpm / 7000 + .14 * coldK() : cranking ? .12 : 0, sweep), dt);   // cold oil is thick: higher pressure
  spring('temp', Math.max(pw ? tempGauge(st.temp) : 0, sweep), dt);
  spring('fuel', Math.max(pw ? fuel : 0, sweep), dt);
  spring('h2o', pw ? st.wash : 0, dt);
  spring('volt', Math.max(!pw ? 0 : st.engineOn ? .62 + .12 * st.batt : cranking ? .3 + .14 * st.batt : .3 + .3 * st.batt, sweep), dt);   // ≈ 14 V charging, 12.x V resting, dips while cranking; a flat battery reads low
}
/* shared frame clock (the main loop and the pause handler both touch it) */
export const clock = { last: performance.now() };
