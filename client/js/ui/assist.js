import { CFG } from '../config.js';
import { guide } from '../guide.js';
import { st, dn, powered, coldK } from '../state.js';
import { wip } from '../cockpit/windscreen.js';
import { resetTutorial, tutorialTips, tutorialOpen } from './tutorial.js';
import { net } from '../net/network.js';
import { FORK } from '../net/patterns.js';
import { phone } from '../phone.js';

/* The free ride's ASSIST + the one place that decides what is highlighted (guide.tips) each frame.
   ASSIST: the truck wears out half as fast (CFG.ASSIST, in sim/damage.js, climate.js, battery.js) and every control / indicator gets a tip at the moment it matters –
   parking brake still on, gear up / down, a stall, the lights at night, a low battery, a failing hull… The tutorial (ui/tutorial.js) takes the tips while a lesson step is open;
   a stalled engine always wins (every lesson after the engine started needs it restarted). Tips stay up ≥ STICKY ms so a needle crossing a threshold does not flicker. */
const K = (id, text, key) => ({ id, text, key }), STICKY = 1400, MAX = 3;
let everOn = false, lastSeen = new Map(), wiperHinted = 0;

const stalled = () => everOn && !st.engineOn && !st.ign;
const stallTips = () => [K('STALL', 'Engine stopped – hold the clutch in and press I to restart', 'I'), K('key-start', 'Or hold START on the key')];

function assistTips() {
  const T = [];
  if (!st.engineOn && !st.ign) { if (stalled()) return stallTips(); T.push(st.keyOn ? K('key-start', 'Hold START to crank the engine', 'I') : K('key-on', 'Turn the key to ON, then START', 'I')); return T; }
  if (st.park) { T.push(K('park', st.v > .5 ? 'The parking brake is ON – release it' : 'Release the parking brake', 'B')); return T; }
  if (st.gear === 0 && st.v < 1) T.push(K('CLU', 'Hold the clutch in', 'SHIFT'), K('SHIFTER', 'Select 1st gear', 'E'));
  else if (st.gear > 0 && st.v < 1.5 && st.gas < .1) T.push(K('GAS', 'Gas, then ease the clutch out', 'W'));
  if (st.v >= 1.5) {
    if (st.rpm > 2300 && st.gear > 0 && st.gear < 7) T.push(K('RPM×100', 'Revs are high – gear UP (clutch in first)', 'E'), K('SHIFTER', 'Shift up'));
    if (st.lug > .25) T.push(K('RPM×100', 'The engine is lugging – gear DOWN (clutch in first)', 'Q'), K('SHIFTER', 'Shift down'));
  }
  if (st.off) T.push(K('OFF ROAD', 'Off the road – steer back before the ride ends', 'A D'));
  if (dn.k > .5 && !dn.head && powered()) T.push(K('head', 'It is dark – headlights on', 'L'));
  if (st.hull < 60) T.push(K('HUL', `Hull ${Math.round(st.hull)} % – avoid holes, signs and cars`));
  if (powered() && !st.engineOn && st.batt < CFG.BATT.START_MIN) T.push(K('BAT', 'Battery too flat to crank – switch lights, heater, cooler and radio off and wait a few seconds, it recovers by itself'));
  else if (powered() && st.batt < CFG.BATT.LOW) T.push(K('BAT', 'Battery low – lights / heater / cooling off, keep the engine running'));
  if (coldK() > .5 && st.rpm > 1800) T.push(K('COLD', 'Cold engine – keep the revs low until TEMP rises'));
  if (st.strain > .15) T.push(K('STRAIN', 'Too many revs for too long – shift up or ease off', 'E'));
  if (st.brakeT > .3) T.push(K('BRAKES', 'The brakes are hot – ease off the pedal'));
  if (st.grind > 0) T.push(K('GRIND', 'Grinding gears – clutch fully in first', 'SHIFT'));
  if (st.overrev) T.push(K('OVER-REV', 'Over-revving – shift up now', 'E'));
  if (!phone.open && st.v > 1 && net.forksNear(st.s, st.s + 450).some(f => f.f0 + FORK.commit > st.s)) T.push(K('map', 'The road splits ahead – the map shows both roads', 'N'));
  if (st.t > 20 && !wiperHinted && wip.mode === 0) wiperHinted = performance.now();   // once: a dusty screen
  if (wiperHinted && performance.now() - wiperHinted < 7000 && wip.mode === 0) T.push(K('wiper', 'Dust on the glass? Wipers (R) – hold X to spray', 'R'));
  return T;
}

/** a ride starts (ui/game.js) */
export function startGuide() { everOn = false; lastSeen = new Map(); wiperHinted = 0; guide.tips.length = 0; resetTutorial(); }

/** every frame (main.js), only for a ride with the tutorial or the assist */
export function updateGuide() {
  if (st.mode !== 'drive') { guide.tips.length = 0; tutorialTips(); return; }
  if (st.engineOn) everOn = true;
  let tips = tutorialTips();
  if (!tips && guide.assist && !tutorialOpen()) tips = assistTips();
  const t = performance.now(), out = [];
  for (const tip of tips ?? []) { lastSeen.set(tip.id, { tip, t }); out.push(tip); }
  if (guide.assist && !tutorialOpen()) for (const [id, v] of lastSeen) { if (t - v.t > STICKY) lastSeen.delete(id); else if (!out.some(o => o.id === id) && out.length < MAX) out.push(v.tip); }
  guide.tips.length = 0; guide.tips.push(...out.slice(0, MAX));
}
