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
import { toggleFormShade } from '../world/nightlight.js';
import { online } from '../online.js';
import { fmt } from '../util.js';
import { SITE_BASE } from '../hosts.js';
import { ridePageUrl, rideShareText, xIntent } from './share.js';
import { env } from '../world/environment.js';
import { isMobileDevice } from '../mobile.js';
import { track } from '../analytics.js';

/* Keyboard + mouse input. Side effects only: listeners are attached on import. */

/* ───────────────────────── input ───────────────────────── */
const KEYS = {
  KeyW: 'gas', ArrowUp: 'gas', KeyS: 'brake', ArrowDown: 'brake', KeyA: 'left', ArrowLeft: 'left', KeyD: 'right', ArrowRight: 'right',
  ShiftLeft: 'clutch', ShiftRight: 'clutch', Space: 'clutch', KeyX: 'wash',
};
const volumeMsg = d => { radio.volume(d); toast('Radio volume ' + Math.round(radio.vol * 100) + '%', 900); };
const radioMsg = on => toast(!on ? 'Radio off' : st.mode === 'drive' && !powered() ? 'Radio: turn the key to ON' : 'FM ' + radio.station.freq.toFixed(1) + ' · ' + radio.station.name, 1600);
const seekRadio = d => { radio.seek(d); radioMsg(true); };
const toggleMute = () => { audio.muted = !audio.muted; toast(audio.muted ? 'Sound off' : 'Sound on', 1000); };
const flipHeadlights = withToast => { dn.head = !dn.head; audio.play(dn.head ? 'switch' : 'switch-off'); if (withToast) toast(dn.head ? 'Headlights on' : 'Headlights off', 1000); };
const driveOnly = fn => () => { if (st.mode === 'drive') fn(); };

const KEY_ACTIONS = {
  KeyE: () => tryShift(st.gear + 1),
  KeyQ: () => tryShift(st.gear - 1),
  KeyG: () => tryShift(-1),
  KeyI: () => ignition(),
  KeyO: () => engineOff(),
  KeyB: driveOnly(toggleParkingBrake),
  KeyH: driveOnly(toggleHeater),
  KeyJ: driveOnly(toggleCooler),
  KeyR: driveOnly(cycleWipers),
  KeyP: () => setPaused(st.mode === 'drive'),
  KeyL: () => flipHeadlights(true),
  KeyC: () => toggleCab(),
  KeyM: toggleMute,
  KeyN: driveOnly(toggleMap),   // the phone map (ui/map.js) – not from the menu / pause / end panel
  KeyT: () => radioMsg(radio.toggle()),
  Period: () => seekRadio(1),
  Comma: () => seekRadio(-1),
  Minus: () => volumeMsg(-.1),
  Equal: () => volumeMsg(.1),
  Enter: () => { if (st.mode === 'menu' || st.mode === 'done') document.getElementById('go')?.click(); },
};

addEventListener('keydown', e => {
  if (!st.watch && isMobileDevice()) return;
  const inField = e.target?.closest?.('input, textarea');
  if (e.code === 'F8' && !e.repeat && !inField) { e.preventDefault(); toast(toggleFormShade() ? 'Form shade on' : 'Form shade off', 1200); return; }   // not recorded: a look switch, not a driving input
  if (st.watch) {   // a spectator drives nothing: keys belong to the watch panel (chat box), only M mutes and N opens the map
    if (e.code === 'KeyM' && !inField) toggleMute();
    if (e.code === 'KeyN' && !e.repeat && !inField) toggleMap();
    return;
  }
  if (!e.repeat) { recordInput(e.code, 1, e.timeStamp); if (st.mode === 'drive') answerPrompt(e.code); }   // online rides only (no-op otherwise): the server's human-likeness check reads the timing; a dispatch prompt is answered by its key
  if (KEYS[e.code]) { input[KEYS[e.code]] = 1; e.preventDefault(); return; }
  if (e.repeat) return;
  if (/^Digit[0-7]$/.test(e.code)) { tryShift(+e.code.slice(5)); return; }
  if (e.code === 'KeyJ') { if (st.mode === 'drive') toggleCooler(); return; }
  KEY_ACTIONS[e.code]?.();
});
addEventListener('keyup', e => { if (st.watch) return; recordInput(e.code, 0, e.timeStamp); if (KEYS[e.code]) { input[KEYS[e.code]] = 0; e.preventDefault(); } });
addEventListener('blur', () => { for (const k in input) input[k] = 0; releaseInputs(); });

/* clickable dash buttons (WIPER / WASH) – only for a pointer on the game itself (the 3D canvas / the page), never one on a panel over it
   (#watch, #phone, #overlay, #cb, #tutorial…) whose rectangle happens to overlap a dash button's */
const onCab = e => { const t = e.target; return !t || t === document.body || t === document.documentElement || (t.tagName === 'CANVAS' && !t.closest('#phone')); };
const btnAt = e => (onCab(e) ? uiBtns.find(b => e.clientX >= b.x && e.clientX <= b.x + b.w && e.clientY >= b.y && e.clientY <= b.y + b.h) : undefined);
let heldBtn = null;
let recBtn = null;   // the dash button whose press was recorded, so the release is recorded too
function shareRideProgress() {
  if (!online.ride) return;   // a guest run and a replay never post; the watch page returns before this button
  track('ride_share_clicked', { surface: 'dash', link: 'ride', ride_id: online.ride.id });
  const text = rideShareText({ phase: 'driving', route: env.theme?.name, km: `${(st.s / 1000).toFixed(1)} km`, time: fmt(st.t), free: online.ride.tier === 'free' });
  const url = ridePageUrl(SITE_BASE, typeof location !== 'undefined' ? location.origin : '', online.ride.id);
  if (typeof window !== 'undefined' && window.open) window.open(xIntent(text, url), '_blank', 'noopener,noreferrer');
  toast('Opening 𝕏 to share ride progress...', 2000);
}
const BTN_ACTIONS = {
  wiper: cycleWipers,
  wash: () => { input.wash = 1; heldBtn = 'wash'; },
  'key-off': () => keySwitch(false),
  'key-on': () => keySwitch(true),
  'key-start': () => { if (!st.engineOn) { ignition(true); heldBtn = 'key'; } },
  park: toggleParkingBrake,
  'share-x': shareRideProgress,
  head: () => flipHeadlights(false),
  cab: toggleCab,
  heat: toggleHeater,
  'r-pwr': () => radioMsg(radio.toggle()),
  'r-prev': () => seekRadio(-1),
  'r-next': () => seekRadio(1),
  map: toggleMap,
};
addEventListener('pointerdown', e => {
  if (st.watch && btnAt(e)?.id === 'map') { toggleMap(); return; }
  if (st.mode !== 'drive' || st.watch || isMobileDevice()) return;
  const b = btnAt(e); if (!b) return;
  recBtn = `btn:${b.id}`; recordInput(recBtn, 1, e.timeStamp); answerPrompt(recBtn);
  if (b.id === 'cold') toggleCooler();
  else BTN_ACTIONS[b.id]?.();
});
const releaseHeld = e => { if (recBtn) { recordInput(recBtn, 0, e?.timeStamp); recBtn = null; } if (heldBtn === 'wash') input.wash = 0; else if (heldBtn === 'key') releaseKey(); heldBtn = null; };
addEventListener('pointerup', releaseHeld); addEventListener('pointercancel', releaseHeld); addEventListener('blur', releaseHeld);
addEventListener('pointermove', e => { const b = btnAt(e); document.body.style.cursor = st.mode === 'drive' && b && (!st.watch || b.id === 'map') ? 'pointer' : ''; });
