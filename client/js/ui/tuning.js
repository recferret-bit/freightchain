import { store } from '../util.js';
import { CFG } from '../config.js';
import { dn } from '../state.js';
import { setTimeScale, setClockRun, setClock, clockText } from '../world/daynight.js';

/* Live handling tuner (F2): one slider per CFG.TRUCK constant, saved in localStorage['freightchain.truck'].
   Edits CFG.TRUCK in place, so the sim picks changes up next frame; "copy" prints the values to paste into config.js. */
const T = CFG.TRUCK, DEFAULTS = { ...T };
const SPEC = [   // key, min, max, step, label
  ['MASS', .5, 8, .1, 'Mass (thrust/drag ÷)'], ['POWER', .6, 5, .1, 'Engine power'], ['GEAR_EXP', 0, 1, .05, 'Low-gear pull (ratio^x)'], ['SHIFT_TIME', 0, 2, .05, 'Gearshift min time s'], ['LAUNCH_RPM', 0, 2000, 50, 'Clutch-slip revs at full gas'], ['BRAKE', 2, 12, .1, 'Brake decel m/s²'], ['ROLL_RES', 0, .6, .01, 'Rolling resistance'], ['DRAG', 0, .004, .0001, 'Air drag'],
  ['STEER_RATE', .3, 4, .05, 'Wheel turn speed'], ['STEER_RETURN', .3, 6, .05, 'Wheel centring speed'], ['WHEEL_TURNS', .25, 3, .25, 'Wheel turns to lock'], ['STEER_GAIN', .006, .02, .0005, 'Steering authority'], ['STEER_GAIN_LOW', .02, .12, .005, 'Steering at walking pace'], ['YAW_LAG', 0, 2, .05, 'Heading lag s'], ['CENTRIF', 0, .1, .005, 'Bend slide'],
  ['PITCH_GAIN', 0, .01, .0005, 'Pitch (brake dive)'], ['ROLL_GAIN', 0, .01, .0005, 'Roll (cornering)'], ['SWAY_HZ', .3, 3, .05, 'Sway frequency Hz'], ['SWAY_DAMP', .1, 1.2, .05, 'Sway damping'],
];
const TKEY = 'freightchain.truck';
const saved = store.getJSON(TKEY, {});
for (const [k, old] of Object.entries({ GEAR_EXP: .75, LAUNCH_RPM: 1100 })) if (saved[k] === old) delete saved[k];   // old defaults, frozen into saves made before the gearbox rework (they would override the new ones)
Object.assign(T, saved);
const save = () => {   // only what differs from the defaults, so later changes to config.js still reach this browser
  const diff = Object.fromEntries(Object.entries(T).filter(([k, v]) => v !== DEFAULTS[k]));
  if (Object.keys(diff).length) store.set(TKEY, diff); else store.remove(TKEY);
};

const el = document.createElement('div');
el.style.cssText = 'position:absolute;right:10px;top:50px;z-index:4;width:300px;padding:10px 12px;background:#000c;border:1px solid #ffcf5a88;border-radius:6px;font-size:12px;display:none;color:#ddd;max-height:calc(100vh - 70px);overflow-y:auto;overscroll-behavior:contain';
el.innerHTML = '<b style="color:#ffcf5a">TRUCK HANDLING</b> <span style="opacity:.6">(F2 hides)</span>' + SPEC.map(([k, lo, hi, step, label]) =>
  `<label style="display:block;margin-top:5px">${label} <b data-v="${k}" style="color:#ffcf5a;float:right"></b><input type="range" data-k="${k}" min="${lo}" max="${hi}" step="${step}" tabindex="-1" style="width:100%;margin:0"></label>`).join('') +
  '<div style="display:flex;gap:6px;margin-top:8px"><button data-a="reset">reset</button><button data-a="copy">copy</button></div>' +
  `<div style="margin-top:12px;padding-top:8px;border-top:1px solid #ffcf5a44"><b style="color:#ffcf5a">TIME OF DAY</b> <b data-t="clock" style="float:right;color:#ffcf5a"></b>
  <label style="display:block;margin-top:5px">Time scale <b data-t="scaleTxt" style="color:#ffcf5a;float:right"></b><input type="range" data-t="scale" min="0" max="100" step="1" tabindex="-1" style="width:100%;margin:0"></label>
  <label style="display:block;margin-top:5px">Clock <input type="range" data-t="hour" min="0" max="24" step="0.05" tabindex="-1" style="width:100%;margin:0"></label>
  <label style="display:block;margin-top:5px"><input type="checkbox" data-t="run" tabindex="-1"> clock runs while driving</label></div>`;
/* time scale: log slider 0..100 -> x1 … x600 (1 s = 10 min); x1 is real time */
const scaleOf = v => Math.round(Math.pow(600, v / 100) * 10) / 10, human = x => { const s = x < 10 ? +x.toFixed(1) : Math.round(x); return `x${s} · 1 s = ` + (s < 60 ? `${s} s` : `${+(s / 60).toFixed(1)} min`); };
const tq = k => el.querySelector(`[data-t=${k}]`);
const syncTime = () => { tq('clock').textContent = clockText(); tq('scaleTxt').textContent = human(dn.scale); if (document.activeElement !== tq('hour')) tq('hour').value = dn.t; tq('run').checked = dn.run; };
const sv = () => { tq('scale').value = Math.log(dn.scale) / Math.log(600) * 100; syncTime(); };
el.addEventListener('input', e => { const k = e.target.dataset.t; if (k === 'scale') setTimeScale(scaleOf(+e.target.value)); else if (k === 'hour') setClock(+e.target.value, true); else if (k === 'run') setClockRun(e.target.checked); syncTime(); });
setInterval(() => { if (el.style.display !== 'none') syncTime(); }, 250);
el.querySelectorAll('button').forEach(b => b.style.cssText = 'flex:1;font-size:12px;padding:4px;border-radius:4px');
document.body.appendChild(el);
const sync = () => el.querySelectorAll('input[data-k]').forEach(i => { i.value = T[i.dataset.k]; el.querySelector(`[data-v=${i.dataset.k}]`).textContent = +(+T[i.dataset.k]).toPrecision(4); });
el.addEventListener('input', e => { const k = e.target.dataset.k; if (!k) return; T[k] = +e.target.value; el.querySelector(`[data-v=${k}]`).textContent = +T[k].toPrecision(4); save(); });
el.addEventListener('pointerup', e => { if (e.target.type === 'range' || e.target.type === 'checkbox') e.target.blur(); });   // keep arrow keys for driving
el.addEventListener('click', e => {
  const a = e.target.dataset.a; if (a === 'reset') { Object.assign(T, DEFAULTS); save(); sync(); }
  else if (a === 'copy') { const txt = JSON.stringify(T, null, 1); console.log(txt); navigator.clipboard?.writeText(txt).catch(() => console.warn('clipboard blocked – the values are in the console above')); }
});
addEventListener('keydown', e => { if (e.code === 'F2') { e.preventDefault(); el.style.display = el.style.display === 'none' ? 'block' : 'none'; sync(); sv(); } });
