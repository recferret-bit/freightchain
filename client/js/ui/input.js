import { st, input, powered, dn } from '../state.js';
import { tryShift, ignition, engineOff, releaseKey, keySwitch, toggleParkingBrake } from '../sim/physics.js';
import { audio } from '../sim/audio.js';
import { setPaused } from './game.js';
import { toast } from './toast.js';
import { cycleWipers } from '../cockpit/windscreen.js';
import { uiBtns } from '../cockpit/common.js';
import { radio } from '../sim/radio.js';
import { toggleHeater, toggleCooler } from '../sim/climate.js';
import { toggleCab } from '../sim/battery.js';
import { recordInput, releaseInputs } from '../telemetry.js';
import { answerPrompt } from '../prompt.js';
import { toggleMap } from './map.js';

/* Keyboard + mouse input. Side effects only: listeners are attached on import. */

/* ───────────────────────── input ───────────────────────── */
const KEYS = {
  KeyW: 'gas', ArrowUp: 'gas', KeyS: 'brake', ArrowDown: 'brake', KeyA: 'left', ArrowLeft: 'left', KeyD: 'right', ArrowRight: 'right',
  ShiftLeft: 'clutch', ShiftRight: 'clutch', Space: 'clutch', KeyX: 'wash',
};
const volumeMsg = d => { radio.volume(d); toast('Radio volume ' + Math.round(radio.vol * 100) + '%', 900); };
const radioMsg = on => toast(!on ? 'Radio off' : st.mode === 'drive' && !powered() ? 'Radio: turn the key to ON' : 'FM ' + radio.station.freq.toFixed(1) + ' · ' + radio.station.name, 1600);
addEventListener('keydown', e => {
  if (st.watch) {   // a spectator drives nothing: keys belong to the watch panel (chat box), only M mutes and N opens the map
    if (e.code === 'KeyM' && !e.target.closest?.('input, textarea')) { audio.muted = !audio.muted; toast(audio.muted ? 'Sound off' : 'Sound on', 1000); }
    if (e.code === 'KeyN' && !e.repeat && !e.target.closest?.('input, textarea')) toggleMap();
    return;
  }
  if (!e.repeat) { recordInput(e.code, 1, e.timeStamp); if (st.mode === 'drive') answerPrompt(e.code); }   // online rides only (no-op otherwise): the server's human-likeness check reads the timing; a dispatch prompt is answered by its key
  if (KEYS[e.code]) { input[KEYS[e.code]] = 1; e.preventDefault(); return; }
  if (e.repeat) return;
  if (e.code === 'KeyE') tryShift(st.gear + 1);
  else if (e.code === 'KeyQ') tryShift(st.gear - 1);
  else if (e.code === 'KeyG') tryShift(-1);
  else if (/^Digit[0-7]$/.test(e.code)) tryShift(+e.code.slice(5));
  else if (e.code === 'KeyI') ignition();
  else if (e.code === 'KeyO') engineOff();
  else if (e.code === 'KeyB') { if (st.mode === 'drive') toggleParkingBrake(); }
  else if (e.code === 'KeyH') { if (st.mode === 'drive') toggleHeater(); }
  else if (e.code === 'KeyJ') { if (st.mode === 'drive') toggleCooler(); }
  else if (e.code === 'KeyR') { if (st.mode === 'drive') cycleWipers(); }
  else if (e.code === 'KeyP') setPaused(st.mode === 'drive');
  else if (e.code === 'KeyL') { dn.head = !dn.head; audio.play(dn.head ? 'switch' : 'switch-off'); toast(dn.head ? 'Headlights on' : 'Headlights off', 1000); }
  else if (e.code === 'KeyC') toggleCab();
  else if (e.code === 'KeyM') { audio.muted = !audio.muted; toast(audio.muted ? 'Sound off' : 'Sound on', 1000); }
  else if (e.code === 'KeyN') { if (st.mode === 'drive') toggleMap(); }   // the phone map (ui/map.js) – not from the menu / pause / end panel
  else if (e.code === 'KeyT') { radioMsg(radio.toggle()); }
  else if (e.code === 'Period') { radio.seek(1); radioMsg(true); }
  else if (e.code === 'Comma') { radio.seek(-1); radioMsg(true); }
  else if (e.code === 'Minus') volumeMsg(-.1);
  else if (e.code === 'Equal') volumeMsg(.1);
  else if (e.code === 'Enter' && (st.mode === 'menu' || st.mode === 'done')) document.getElementById('go')?.click();
});
addEventListener('keyup', e => { if (st.watch) return; recordInput(e.code, 0, e.timeStamp); if (KEYS[e.code]) { input[KEYS[e.code]] = 0; e.preventDefault(); } });
addEventListener('blur', () => { for (const k in input) input[k] = 0; releaseInputs(); });

/* clickable dash buttons (WIPER / WASH) – only for a pointer on the game itself (the 3D canvas / the page), never one on a panel over it
   (#watch, #phone, #overlay, #cb, #tutorial…) whose rectangle happens to overlap a dash button's */
const onCab = e => { const t = e.target; return !t || t === document.body || t === document.documentElement || (t.tagName === 'CANVAS' && !t.closest('#phone')); };
const btnAt = e => (onCab(e) ? uiBtns.find(b => e.clientX >= b.x && e.clientX <= b.x + b.w && e.clientY >= b.y && e.clientY <= b.y + b.h) : undefined);
let heldBtn = null;
let recBtn = null;   // the dash button whose press was recorded, so the release is recorded too
addEventListener('pointerdown', e => { if (st.watch && btnAt(e)?.id === 'map') { toggleMap(); return; } if (st.mode !== 'drive' || st.watch) return; const b = btnAt(e); if (!b) return; recBtn = `btn:${b.id}`; recordInput(recBtn, 1, e.timeStamp); answerPrompt(recBtn); if (b.id === 'wiper') cycleWipers(); else if (b.id === 'wash') { input.wash = 1; heldBtn = 'wash'; } else if (b.id === 'key-off') keySwitch(false); else if (b.id === 'key-on') keySwitch(true); else if (b.id === 'key-start') { if (!st.engineOn) { ignition(true); heldBtn = 'key'; } } else if (b.id === 'park') toggleParkingBrake(); else if (b.id === 'head') { dn.head = !dn.head; audio.play(dn.head ? 'switch' : 'switch-off'); } else if (b.id === 'cab') toggleCab(); else if (b.id === 'heat') toggleHeater(); else if (b.id === 'cold') toggleCooler(); else if (b.id === 'r-pwr') radioMsg(radio.toggle()); else if (b.id === 'r-prev') { radio.seek(-1); radioMsg(true); } else if (b.id === 'r-next') { radio.seek(1); radioMsg(true); } else if (b.id === 'map') toggleMap(); });
const releaseHeld = e => { if (recBtn) { recordInput(recBtn, 0, e?.timeStamp); recBtn = null; } if (heldBtn === 'wash') input.wash = 0; else if (heldBtn === 'key') releaseKey(); heldBtn = null; };
addEventListener('pointerup', releaseHeld); addEventListener('pointercancel', releaseHeld); addEventListener('blur', releaseHeld);
addEventListener('pointermove', e => { const b = btnAt(e); document.body.style.cursor = st.mode === 'drive' && b && (!st.watch || b.id === 'map') ? 'pointer' : ''; });
