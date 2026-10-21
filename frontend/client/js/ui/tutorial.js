import { guide, cheer } from '../guide.js';
import { CFG } from '../config.js';
import { st, input, dn, powered, driveHull } from '../state.js';
import { wip } from '../cockpit/windscreen.js';
import { audio } from '../sim/audio.js';

/* The free ride's TUTORIAL: a small dialog on top of the gameplay (never a pause – the truck is the lesson) that walks through the controls one at a time.
   Each step names what to do, highlights the controls and indicators involved (guide.tips → cockpit/guide.js) and waits for the driver to DO it; a step the
   driver is already ahead of ticks off at once, SKIP moves on, END TUTORIAL closes it. While it is open `guide.hold` keeps the free run's finish line from
   ending the ride (sim/physics.js), so the lesson is never cut off. The server learns about it when the ride starts (Ride.tutorial → Player.tutorialPassedAt).
   Steps 1–8: ignition · parking brake · first gear + clutch · moving off · shifting up · steering · lights + windscreen · hull + avoiding crashes. */
const K = (id, text, key) => ({ id, text, key });
const seen = {};   // what the driver has done in the current step (reset on each step)
const STEPS = [
  { title: 'IGNITION', text: 'Turn the key to ON, then hold START until the engine catches – or just press I. Nothing on the dash works with the key off.',
    tips: () => [st.keyOn || st.ign ? K('key-start', 'Hold START to crank the engine', 'I') : K('key-on', 'Turn the key to ON', 'I'), K('VOLT', 'Battery voltage – lamps and gauges wake up with the key')], win: 'ENGINE RUNNING – nice start!', done: () => st.engineOn },
  { title: 'PARKING BRAKE', text: 'The truck starts parked – the PARK light is red. Release the parking brake before you move: click PARK or press B.',
    tips: () => [K('park', 'Release the parking brake', 'B')], win: 'BRAKE RELEASED – you are free to roll', done: () => !st.park },
  { title: 'FIRST GEAR & CLUTCH', text: 'Hold the clutch pedal in (SHIFT) all the way, then press E to select 1st gear. You can only change gear with the clutch in. The gear shows in the middle of the dash.',
    tips: () => [K('CLU', 'Hold the clutch pedal in', 'SHIFT'), K('SHIFTER', 'Press E for 1st gear', 'E'), K('GEAR', 'The selected gear')], win: 'FIRST GEAR IN – clean clutch work', done: () => st.gear === 1 },
  { title: 'START MOVING', text: 'Hold W for gas and ease the clutch out slowly (let go of SHIFT). Let it out too fast at low revs and the engine stalls – clutch in and press I to restart.',
    tips: () => [K('GAS', 'Hold the gas pedal', 'W'), K('CLU', 'Release the clutch slowly', 'SHIFT'), K('km/h', 'Your speed')], win: 'YOU ARE MOVING!', done: () => st.v > 3 && st.gear === 1 },
  { title: 'SHIFT UP', text: 'As the RPM needle climbs towards 2000–2500, hold SHIFT, press E for the next gear and let the clutch out. Get up to 3rd gear. Q shifts back down.',
    tips: () => [K('RPM×100', 'Shift up before the needle reaches the red', 'E'), K('SHIFTER', 'Clutch in, then E'), K('CLU', 'Clutch while you shift', 'SHIFT')], win: 'SMOOTH SHIFT – you are in 3rd', done: () => st.gear >= 3 && st.v > 5 },
  { title: 'STEERING', text: 'Steer with A and D (or ← →). The road bends and the wind pushes you – keep the truck between the lines. Too long off the road ends the ride. Try both ways.',
    track: () => { if (input.left && !seen.left) { seen.left = true; cheer('LEFT TURN ✓'); } if (input.right && !seen.right) { seen.right = true; cheer('RIGHT TURN ✓'); } },
    tips: () => [K('WHEEL', 'Steer left / right', 'A D')], win: 'STEERING DONE – left and right', done: () => !!(seen.left && seen.right) },
  { title: 'LIGHTS & WINDSCREEN', text: 'Switch the headlights on (L or HEAD) – you need them at night. Then run the wipers (R or WIPER); hold X or click WASH to spray the screen clean.',
    track: () => { if (dn.head && !seen.head) { seen.head = true; cheer('HEADLIGHTS ON ✓'); } if ((wip.mode > 0 || st.washing) && !seen.wipe) { seen.wipe = true; cheer('WIPERS ON ✓'); } },
    tips: () => [seen.head ? null : K('head', 'Headlights on', 'L'), seen.wipe ? null : K('wiper', 'Wipers on', 'R'), seen.wipe ? null : K('wash', 'Hold to spray the screen', 'X')].filter(Boolean), win: 'LIGHTS AND WIPERS ON', done: () => !!(seen.head && seen.wipe), manual: 'NEXT' },
  { title: 'HULL & CRASHES', text: 'The HUL bar is your truck\'s health. Potholes, signs, rocks and cars all take hull; a head-on crash, a building or 0 % ends the ride. Watch for yellow warning signs, keep to your lane, slow down for holes.',
    tips: () => [K('HUL', `Hull ${Math.round(driveHull())} % – 0 % ends the ride`), K('OFF ROAD', 'Lights up when you leave the road')], done: () => false, manual: 'GOT IT' },
];
export const stepCount = STEPS.length;

/* NEGATIVE CASES: what the driver can get wrong on the way. While one is true the dialog swaps its lesson for an amber WARNING – what happened, why, and the next
   actions in order – and highlights the controls that fix it; the lesson comes back by itself when it is put right. `ran` = the engine has run this ride (so "off" means stalled). */
let ran = false;
const NEXT = 'Next: ';
function trouble(i) {
  const first = i === 0;
  if (ran && !st.engineOn && !st.ign) {   // a stall (or the key turned off)
    const why = i === 3 ? 'You let the clutch out too fast for the revs – the engine was dragged below 450 rpm and died. '
      : i === 4 ? 'The engine died while shifting – the clutch came out too early or the revs had dropped too far. ' : 'The engine is off – a stall, or the key was turned off. ';
    return { key: 'stall', title: 'ENGINE STALLED', text: `${why}${NEXT}1) hold SHIFT in, 2) press I (or hold START) until it catches, 3) ${i >= 3 ? 'give it a little more gas (W) than before and release SHIFT slowly.' : 'carry on with the step.'}`,
      tips: [K('STALL', 'Engine stopped'), K('CLU', 'Hold the clutch in', 'SHIFT'), K('key-start', 'Press I or hold START', 'I')] };
  }
  if (!first && powered() && st.batt < CFG.BATT.LOW) return { key: 'bat', title: 'BATTERY LOW', text: `Lights, heater, cooling and radio drain the battery; below ~12 % the engine will not crank. ${NEXT}switch them off and keep the engine running – the alternator recharges it.`, tips: [K('BAT', 'Battery low'), K('head', 'Lights off', 'L')] };
  if (!first && st.park && st.v > .5) return { key: 'park', title: 'PARKING BRAKE ON', text: `The parking brake is on while you move – it drags the truck and overheats the brakes. ${NEXT}release it: click PARK or press B.`, tips: [K('park', 'Release the parking brake', 'B')] };
  if (st.grind > 0) return { key: 'grind', title: 'GEARS GRINDING', text: `You changed gear without the clutch fully in. ${NEXT}hold SHIFT all the way (the CLU bar must be full), press E or Q, then let it out.`, tips: [K('GRIND', 'Grinding'), K('CLU', 'Clutch fully in', 'SHIFT'), K('SHIFTER', 'Then change gear', 'E')] };
  if (i >= 3 && st.gear === 0 && st.engineOn && !st.park) return { key: 'neutral', title: 'NO GEAR SELECTED', text: `The shifter is in neutral – the gas only revs the engine, the truck does not pull. ${NEXT}hold SHIFT, press E for 1st gear, then gas and release the clutch slowly.`, tips: [K('GEAR', 'N = neutral'), K('CLU', 'Clutch in', 'SHIFT'), K('SHIFTER', 'Select a gear', 'E')] };
  if (i >= 3 && (st.overrev || (st.rpm > 2600 && st.gear > 0 && st.gear < 7))) return { key: 'rev', title: 'REVS TOO HIGH', text: `Holding the engine near the redline fills the STRAIN lamp – too long and it blows. ${NEXT}hold SHIFT, press E for the next gear, release the clutch.`, tips: [K('RPM×100', 'Near the red'), K('STRAIN', 'Fills up'), K('SHIFTER', 'Gear up', 'E')] };
  if (i >= 3 && st.lug > .25) return { key: 'lug', title: 'ENGINE LUGGING', text: `The revs are too low for this gear – the engine shudders and will stall. ${NEXT}hold SHIFT and press Q for a lower gear, or give it more gas (W).`, tips: [K('RPM×100', 'Too low'), K('SHIFTER', 'Gear down', 'Q'), K('GAS', 'More gas', 'W')] };
  if (i >= 3 && st.off) return { key: 'off', title: 'OFF THE ROAD', text: `Too long off the tarmac ends the ride (20 s). ${NEXT}steer back onto the road with A / D and ease off the gas.`, tips: [K('OFF ROAD', 'You left the road'), K('WHEEL', 'Steer back', 'A D')] };
  if (i >= 3 && driveHull() < 60) return { key: 'hull', title: 'TRUCK DAMAGED', text: `The hull is at ${Math.round(driveHull())} % – less power, and the steering pulls to one side. ${NEXT}slow down, keep to your lane and steer round holes and signs; 0 % ends the ride.`, tips: [K('HUL', `Hull ${Math.round(driveHull())} %`)] };
  return null;
}

/* PACE – nothing flashes: a step stays up at least MIN_STEP ms even if the driver was already ahead of it, a finished step shows its ✓ for DONE_MS, and a warning needs
   its problem to last WARN_AFTER ms to appear and then stays at least WARN_HOLD ms (WARN_GONE ms of the problem being gone first) so a needle brushing a threshold does not blink it. */
const MIN_STEP = 3000, DONE_MS = 2200, WARN_AFTER = 800, WARN_HOLD = 3500, WARN_GONE = 1500;
let stepAt = 0, pend = null, cur = null;
let i = 0, doneAt = 0, box = null, parts = null, over = false, closeAt = 0, shown = null;
const now = () => performance.now();
const h = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text) e.textContent = text; return e; };

function mount() {
  box = h('div'); box.id = 'tutorial'; box.hidden = true;
  const head = h('div', 'tu-head'), dots = h('span', 'tu-dots'), count = h('b', 'tu-count'), title = h('b', 'tu-title');
  head.append(count, title, dots);
  const text = h('p', 'tu-text'), row = h('div', 'tu-row'), skip = h('button', 'tu-skip', 'SKIP ▸'), end = h('button', 'tu-end', 'END TUTORIAL');
  for (const b of [skip, end]) { b.type = 'button'; b.tabIndex = -1; b.addEventListener('mousedown', e => e.preventDefault()); }   // never take the keyboard focus: SPACE is the clutch
  skip.addEventListener('click', advanceTutorial); end.addEventListener('click', endTutorial);
  row.append(skip, end); box.append(head, text, row); document.body.append(box);
  parts = { count, title, dots, text, skip, end };
}
function paint() {
  const s = STEPS[i]; if (!s || !parts) return;
  parts.count.textContent = `${i + 1}/${STEPS.length}`; parts.title.textContent = s.title; parts.text.textContent = s.text;
  parts.dots.textContent = STEPS.map((_, k) => (k < i ? '●' : k === i ? '◉' : '○')).join(' ');
  parts.skip.textContent = s.manual ? `${s.manual} ▸` : 'SKIP ▸'; box.classList.remove('ok', 'fin', 'warn'); noted = ''; guide.note = '';
}
let noted = '';
function warn(tr) {   // swap the lesson for the warning (once per case) – or back
  const key = tr?.key ?? '';
  if (key === noted) return;
  if (!tr) { paint(); return; }
  noted = key; guide.note = tr.title; box.classList.add('warn'); parts.title.textContent = `⚠ ${tr.title}`; parts.text.textContent = tr.text;
}
function show(on) {
  if (!box || shown === on) return;
  shown = on; box.hidden = !on; document.body.classList.toggle('tutorial', on);
}
function advance() { i++; doneAt = 0; stepAt = now(); pend = cur = null; noted = ''; guide.note = ''; for (const k in seen) delete seen[k]; if (i >= STEPS.length) finish('done'); else paint(); }
function finish(how) {
  guide.hold = false; guide.tips.length = 0; over = true; closeAt = now() + (how === 'done' ? 4500 : 0);
  if (how === 'done') cheer('TUTORIAL COMPLETE – drive on!');
  if (how === 'done' && box) { box.classList.add('fin'); parts.count.textContent = '✓'; parts.title.textContent = 'TUTORIAL COMPLETE'; parts.text.textContent = 'That is everything. Drive on to the finish line – the HUL bar is your hull, keep it up.'; parts.dots.textContent = ''; parts.skip.hidden = parts.end.hidden = true; }
  if (how === 'closed') show(false);
}

/** a new ride starts (ui/game.js): rewind the lesson */
export function resetTutorial() {
  ran = false; noted = ''; guide.note = ''; stepAt = performance.now(); pend = cur = null; i = 0; doneAt = 0; over = false; closeAt = 0; shown = null; for (const k in seen) delete seen[k];
  if (guide.tutorial) { if (!box) mount(); parts.skip.hidden = parts.end.hidden = false; paint(); } else show(false);
  guide.hold = guide.tutorial;
}
/** every frame while the tutorial is on: keeps the dialog in step and returns the tips to highlight (null = none) */
export function tutorialTips() {
  if (!guide.tutorial || !box) return null;
  if (st.mode !== 'drive') { show(false); return null; }
  if (over) { show(closeAt > now()); return closeAt > now() ? [] : null; }
  show(true);
  const s = STEPS[i];
  if (doneAt) {
    if (!s.done()) { doneAt = 0; box.classList.remove('ok'); parts.title.textContent = s.title; }
    else if (now() - doneAt > DONE_MS && now() - stepAt > MIN_STEP) advance();
    return null;
  }
  s.track?.();
  if (st.engineOn) ran = true;
  const raw = trouble(i), t = now();
  if (raw?.key !== pend?.tr.key) pend = raw ? { tr: raw, at: t } : null;   // a candidate warning, and since when it has held
  if (cur) { if (raw?.key === cur.tr.key) cur.last = t; else if (t - cur.last > WARN_GONE && t - cur.at > WARN_HOLD) { if (cur.tr.key === 'stall' && st.engineOn) cheer('ENGINE BACK ON – good recovery'); cur = null; } }
  if (!cur && pend && t - pend.at > WARN_AFTER) cur = { tr: pend.tr, at: t, last: t };
  warn(cur?.tr);
  if (!cur && s.done()) { doneAt = now(); box.classList.add('ok'); audio.play('ui'); box.classList.remove('warn'); parts.title.textContent = `${s.title} ✓`; if (s.win) cheer(s.win); return null; }
  return cur ? cur.tr.tips : s.tips();
}
export const endTutorial = () => finish('closed');
export const advanceTutorial = () => { audio.play('ui'); advance(); };
export const tutorialOpen = () => guide.tutorial && (!over || closeAt > now());
