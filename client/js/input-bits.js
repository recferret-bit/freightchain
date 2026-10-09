/* The driver's INPUTS in a replay (live streams): column 14 of every recorded sample (client/js/telemetry.js) is a bitmask of the controls that were held at
   that sample OR pressed since the one before – so a key tap or a dash click shorter than the 100 ms between two samples still shows. One bit per CONTROL
   (W and ↑ are both GAS), plus MOUSE when a dash button was clicked rather than its key pressed. Nothing finer than the sample: the raw input events (ms
   timing, read by the verdict's human-likeness check) stay private. The spectator's page lights each control up as a flashing yellow border (cockpit/index.js).
   A LEAF module: telemetry.js writes the mask, watch.js decodes it, the cockpit draws it – keep it free of imports.
   Bits are FOREVER (old recordings keep their meaning): append new controls, never renumber. ≤ 30 bits (JS bitwise is 32-bit signed). */
export const INPUT_COL = 14;   // the sample column (server/src/domain/telemetry/telemetry-rules.ts SAMPLE_INPUT_COL)
export const CONTROLS = ['gas', 'brake', 'left', 'right', 'clutch', 'up', 'down', 'gear', 'reverse', 'start', 'stop', 'keyOn', 'park', 'heat', 'wiper', 'wash',
  'head', 'cab', 'night', 'radio', 'prev', 'next', 'volume', 'pause', 'mute', 'map'];
export const MOUSE = 1 << 25;   // a dash button was clicked (with the mouse / a tap)
export const BIT = Object.fromEntries(CONTROLS.map((c, i) => [c, 1 << (i < 25 ? i : i + 1)]));   // controls appended after 'mute' skip bit 25 (MOUSE): 'map' = 1 << 26

/* key code → control (the keys ui/input.js acts on; anything else – the menu's Enter, F2 – is no control) */
const KEY = {
  KeyW: 'gas', ArrowUp: 'gas', KeyS: 'brake', ArrowDown: 'brake', KeyA: 'left', ArrowLeft: 'left', KeyD: 'right', ArrowRight: 'right',
  ShiftLeft: 'clutch', ShiftRight: 'clutch', Space: 'clutch', KeyE: 'up', KeyQ: 'down', KeyG: 'reverse', KeyI: 'start', KeyO: 'stop', KeyB: 'park', KeyH: 'heat',
  KeyR: 'wiper', KeyX: 'wash', KeyL: 'head', KeyC: 'cab', KeyN: 'map', KeyT: 'radio', Comma: 'prev', Period: 'next', Minus: 'volume', Equal: 'volume',
  KeyP: 'pause', KeyM: 'mute',
};
for (let g = 0; g <= 7; g++) KEY[`Digit${g}`] = 'gear';
/* dash button id (cockpit uiBtns, recorded as `btn:<id>`) → control */
const BTN = { wiper: 'wiper', wash: 'wash', 'key-off': 'stop', 'key-on': 'keyOn', 'key-start': 'start', park: 'park', head: 'head', cab: 'cab', heat: 'heat', 'r-pwr': 'radio', 'r-prev': 'prev', 'r-next': 'next', map: 'map' };
/** the dash buttons a control is drawn around (its key and its click light the same button) */
export const DASH = Object.fromEntries(CONTROLS.map(c => [c, Object.keys(BTN).filter(id => BTN[id] === c)]));
/** the key cap shown for a control pressed on the keyboard; the driving cluster (Q W E / A S D / ⇧) is always on screen in a replay */
export const CAP = { gas: 'W', brake: 'S', left: 'A', right: 'D', clutch: '⇧', up: 'E', down: 'Q', gear: '1-7', reverse: 'G', start: 'I', stop: 'O', park: 'B', heat: 'H',
  wiper: 'R', wash: 'X', head: 'L', cab: 'C', night: 'N', radio: 'T', prev: ',', next: '.', volume: '±', pause: 'P', mute: 'M', map: 'N' };   // N was the night key once (old recordings keep 'night'), now it is the map
export const CLUSTER = ['down', 'gas', 'up', 'left', 'brake', 'right', 'clutch'];

/** the bits one recorded input code sets: a key → its control, `btn:<id>` → its control + MOUSE, anything else → 0 */
export function inputBits(code) {
  const s = String(code);
  if (s.startsWith('btn:')) { const c = BTN[s.slice(4)]; return c ? BIT[c] | MOUSE : 0; }
  const c = KEY[s]; return c ? BIT[c] : 0;
}
/** the mask of a set of held codes */
export function maskOf(codes) { let m = 0; for (const c of codes) m |= inputBits(c); return m; }
/** a column value read from a recording: a mask, or 0 for anything else (an old recording has no column; a modified client may send anything) */
export const readMask = v => (Number.isInteger(v) && v > 0 && v < 2 ** 30 ? v : 0);

/** the inputs a replay frame lights: row `i` (the sample at the playhead – paused, it stays lit) OR every row the playhead passed since the last frame
    (`lastT` = the playhead's sample time then) – a 16× replay steps over ~8 samples a frame and a tap recorded in one of them must still flash. After a
    jump (lastT < 0), going back, or more than SCAN rows: only row i. */
export const SCAN = 64;   // rows (6.4 s of recording: more than any frame passes at 16×)
export function passedMask(R, i, lastT) {
  const t = R[i][0], from = lastT < 0 || lastT > t || i > 0 && R[Math.max(0, i - SCAN)][0] > lastT ? t - 1e-6 : lastT;
  let m = readMask(R[i][INPUT_COL]);
  for (let j = i - 1; j >= 0 && j > i - SCAN && R[j][0] > from; j--) m |= readMask(R[j][INPUT_COL]);
  return m;
}

/* ───────── the spectator's lights: what the cockpit draws ───────── */
export const FADE = .45;   // s (WALL time – a 16× replay still shows a tap) a released control keeps glowing
/** lit[i] 0..1 per control (1 = held now), via mouse or key – read by cockpit/index.js; `on` = a replay is feeding it (the watch page) */
export const inputLights = { on: false, mask: 0, key: new Float32Array(CONTROLS.length), mouse: new Float32Array(CONTROLS.length) };
/** every frame of a replay: `mask` = the OR of every sample the playhead passed since the last frame, `dt` = the frame's wall seconds */
export function lightInputs(mask, dt, L = inputLights) {
  L.mask = mask;
  const viaMouse = (mask & MOUSE) !== 0;
  for (let i = 0; i < CONTROLS.length; i++) {
    const on = (mask & (1 << i)) !== 0, mouse = on && viaMouse && DASH[CONTROLS[i]].length > 0;   // a click only ever presses a dash button
    L.mouse[i] = mouse ? 1 : Math.max(0, L.mouse[i] - dt / FADE);
    L.key[i] = on && !mouse ? 1 : Math.max(0, L.key[i] - dt / FADE);
  }
  return L;
}
export function clearInputs(L = inputLights) { L.mask = 0; L.key.fill(0); L.mouse.fill(0); }
