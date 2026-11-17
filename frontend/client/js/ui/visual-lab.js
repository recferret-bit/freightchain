import { CFG } from '../config.js';
import { store } from '../util.js';
import { setFormShade } from '../world/nightlight.js';
import {
  getPixelArtParams, getPixelScope, isPixelArtOn, onPixelArtChange,
  resetPixelArtParams, setPixelArt, setPixelArtParams, setPixelScope, togglePixelArt,
} from '../world/pixel-pass.js';
import {
  getCrtParams, isCrtOn, onCrtChange, resetCrtParams, setCrt, setCrtParams, toggleCrt,
} from './crt.js';

/* Floating Faction-Plate dialog to live-tune the ported TerraAgent Pixel-Art & CRT shaders and 3D form shade.
   Toggle open/closed with F8. Draggable by its header. */

const TAB_KEY = 'freightchain.visual.tab';

const PIXEL_SLIDERS = [
  { key: 'pixelSize', label: 'PIXEL SIZE', min: 1, max: 12, step: 0.5, fmt: v => `${v.toFixed(1)} px` },
  { key: 'colorLevels', label: 'COLOR LEVELS', min: 2, max: 64, step: 1, fmt: v => `${Math.round(v)} steps` },
  { key: 'dither', label: 'BAYER DITHER', min: 0, max: 2, step: 0.05, fmt: v => `${Math.round(v * 100)}%` },
  { key: 'edgeStrength', label: 'EDGE INK / RIDGE', min: 0, max: 2, step: 0.05, fmt: v => `${Math.round(v * 100)}%` },
  { key: 'saturation', label: 'SATURATION', min: 0, max: 2.5, step: 0.05, fmt: v => `${Math.round(v * 100)}%` },
  { key: 'contrast', label: 'CONTRAST', min: 0.5, max: 2.0, step: 0.05, fmt: v => `${Math.round(v * 100)}%` },
  { key: 'gridStrength', label: 'PIXEL GRID BEVEL', min: 0, max: 0.35, step: 0.01, fmt: v => `${Math.round(v * 100)}%` },
];

const CRT_SLIDERS = [
  { key: 'scanlineIntensity', label: 'SCANLINE OPACITY', min: 0, max: 0.65, step: 0.01, fmt: v => `${Math.round(v * 100)}%` },
  { key: 'linePitch', label: 'SCANLINE PITCH', min: 2, max: 8, step: 1, fmt: v => `${Math.round(v)} px` },
  { key: 'crawlSpeed', label: 'SCAN CRAWL PERIOD', min: 0.1, max: 4.0, step: 0.1, fmt: v => `${v.toFixed(1)} s` },
  { key: 'rollIntensity', label: 'ROLL BAND GLOW', min: 0, max: 0.25, step: 0.005, fmt: v => `${(v * 100).toFixed(1)}%` },
  { key: 'rollSpeed', label: 'ROLL BAND PERIOD', min: 2, max: 20, step: 0.5, fmt: v => `${v.toFixed(1)} s` },
  { key: 'noiseOpacity', label: 'TAPE GRAIN NOISE', min: 0, max: 0.30, step: 0.005, fmt: v => `${(v * 100).toFixed(1)}%` },
  { key: 'flickerStrength', label: 'FLICKER PULSE', min: 0, max: 0.25, step: 0.005, fmt: v => `${(v * 100).toFixed(1)}%` },
  { key: 'vignetteStrength', label: 'TUBE VIGNETTE', min: 0, max: 0.95, step: 0.02, fmt: v => `${Math.round(v * 100)}%` },
  { key: 'waveAmplitude', label: 'GLITCH WAVE SHIFT', min: 0, max: 40, step: 1, fmt: v => `${Math.round(v)} px` },
  { key: 'waveFrequency', label: 'GLITCH WAVE FREQ', min: 0.002, max: 0.050, step: 0.002, fmt: v => v.toFixed(3) },
  { key: 'waveInterval', label: 'GLITCH WAVE DELAY', min: 2, max: 60, step: 1, fmt: v => `${Math.round(v)} s` },
];

const PALETTES = ['FULL RGB', 'GAMEBOY', 'AMBER', 'CYBER'];

const CSS = `
#pixel-dlg{position:fixed;left:12px;bottom:16px;z-index:70;width:368px;max-height:calc(100vh - 28px);display:none;flex-direction:column;overflow:hidden;box-sizing:border-box;
  font:500 11px/1.35 ui-monospace,SFMono-Regular,Menlo,monospace;color:#f2f4f7;
  background:rgba(11,13,17,.94);border:1px solid #2a3140;border-top:3px solid #ff6a13;
  backdrop-filter:blur(10px);box-shadow:0 16px 40px rgba(0,0,0,.65);user-select:none;
  clip-path:polygon(10px 0,100% 0,100% calc(100% - 10px),calc(100% - 10px) 100%,0 100%,0 10px)}
#pixel-dlg.open{display:flex}
#pixel-dlg .pd-head{display:flex;align-items:center;justify-content:space-between;padding:8px 12px;flex:0 0 auto;
  background:rgba(7,8,10,.75);border-bottom:1px solid #232936;cursor:move;letter-spacing:.14em}
#pixel-dlg .pd-title{font-weight:700;color:#f2f4f7;display:flex;align-items:center;gap:7px}
#pixel-dlg .pd-title i{width:7px;height:7px;background:#ff6a13;display:inline-block}
#pixel-dlg .pd-sub{font-size:10px;color:#8a93a6;letter-spacing:.08em}
#pixel-dlg .pd-close{background:none;border:1px solid transparent;color:#8a93a6;cursor:pointer;font:inherit;padding:2px 6px;flex:0 0 auto}
#pixel-dlg .pd-close:hover{color:#f2f4f7;border-color:#ff6a13}
#pixel-dlg .pd-body{padding:10px 12px;display:flex;flex-direction:column;gap:7px;flex:1 1 auto;min-height:0;overflow:hidden}
#pixel-dlg .pd-tabs{display:grid;grid-template-columns:repeat(3,1fr);gap:4px;flex:0 0 auto}
#pixel-dlg .pd-tab{background:#141820;border:1px solid #262c3a;color:#8a93a6;padding:6px 4px;font:600 9px/1 inherit;
  letter-spacing:.08em;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:4px;text-transform:uppercase;border-radius:0}
#pixel-dlg .pd-tab:hover{border-color:#ff6a13;color:#f2f4f7}
#pixel-dlg .pd-tab.on{background:rgba(255,106,19,.16);border-color:#ff6a13;color:#ff8a3d}
#pixel-dlg .pd-dot{width:5px;height:5px;border-radius:50%;background:#3a4152;display:inline-block}
#pixel-dlg .pd-dot.live{background:#3ddc84;box-shadow:0 0 6px #3ddc84}
#pixel-dlg .pd-top{display:flex;align-items:center;justify-content:space-between;gap:8px;padding-bottom:6px;border-bottom:1px solid #1e232e;flex:0 0 auto}
#pixel-dlg .pd-toggle{background:#181c24;border:1px solid #2a3140;color:#cfd6e4;padding:5px 10px;font:600 10px/1 inherit;flex:0 0 auto;border-radius:0;
  letter-spacing:.12em;cursor:pointer;clip-path:polygon(5px 0,100% 0,100% calc(100% - 5px),calc(100% - 5px) 100%,0 100%,0 5px)}
#pixel-dlg .pd-toggle[aria-pressed="true"]{background:#ff6a13;border-color:#ff6a13;color:#07080a}
#pixel-dlg .pd-sliders{display:flex;flex-direction:column;gap:6px;flex:1 1 auto;min-height:0;overflow-y:auto;padding-right:6px}
#pixel-dlg .pd-sliders>*{flex-shrink:0}
#pixel-dlg .pd-row{display:flex;flex-direction:column;gap:2px}
#pixel-dlg .pd-group{font-size:9px;font-weight:700;letter-spacing:.16em;color:#38bfd4;padding-top:2px;border-bottom:1px solid #1e232e;padding-bottom:3px}
#pixel-dlg .pd-lbl{display:flex;justify-content:space-between;font-size:10px;letter-spacing:.08em;color:#cfd6e4}
#pixel-dlg .pd-lbl b{color:#ff8a3d;font-weight:600;font-variant-numeric:tabular-nums}
#pixel-dlg input[type=range]{-webkit-appearance:none;appearance:none;width:100%;height:5px;background:#1d222d;outline:none;margin:2px 0}
#pixel-dlg input[type=range]::-webkit-slider-thumb{-webkit-appearance:none;width:12px;height:12px;background:#ff6a13;border:1px solid #07080a;cursor:pointer}
#pixel-dlg .pd-box{background:#12161e;border:1px solid #232a38;padding:7px;display:flex;flex-direction:column;gap:5px}
#pixel-dlg .pd-presets{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:4px}
#pixel-dlg .pd-presets.four{grid-template-columns:1.2fr 1.15fr 0.85fr 0.85fr}
#pixel-dlg .pd-btn{background:#181d27;border:1px solid #293142;color:#cfd6e4;padding:5px 3px;font:600 9px/1 inherit;min-width:0;
  letter-spacing:.03em;cursor:pointer;text-align:center;border-radius:0;white-space:nowrap}
#pixel-dlg .pd-btn:hover,#pixel-dlg .pd-btn.on{border-color:#ff6a13;color:#ff8a3d;background:rgba(255,106,19,.14)}
#pixel-dlg .pd-note{font-size:10px;color:#9aa6b2;line-height:1.45}
#pixel-dlg .pd-foot{display:flex;justify-content:space-between;align-items:center;gap:8px;padding-top:6px;border-top:1px solid #1e232e;flex:0 0 auto}
#pixel-dlg .pd-reset{background:none;border:1px solid #2a3140;color:#8a93a6;padding:4px 9px;font:600 10px/1 inherit;letter-spacing:.12em;cursor:pointer;flex:0 0 auto;border-radius:0}
#pixel-dlg .pd-reset:hover{border-color:#ff6a13;color:#f2f4f7}`;

const TABS = [
  {
    id: 'pixel',
    label: 'PIXEL',
    statusTitle: 'PIXEL SHADER STATUS (F10)',
    sliders: PIXEL_SLIDERS,
    isOn: isPixelArtOn,
    toggle: togglePixelArt,
    getParams: getPixelArtParams,
    setParam: (k, v) => { if (!isPixelArtOn()) setPixelArt(true); setPixelArtParams({ [k]: v }); },
    reset: resetPixelArtParams,
    headHtml() {
      return `
        <div class="pd-box">
          <div class="pd-group">PIXEL SCOPE</div>
          <div class="pd-presets">
            <button type="button" class="pd-btn" data-scope="world">OUT OF COCKPIT</button>
            <button type="button" class="pd-btn" data-scope="all">WHOLE GAME</button>
          </div>
          <div class="pd-group">PALETTE</div>
          <div class="pd-presets four">
            ${PALETTES.map((name, i) => `<button type="button" class="pd-btn" data-pal="${i}">${name}</button>`).join('')}
          </div>
        </div>`;
    },
    bind(box) {
      box.querySelectorAll('[data-scope]').forEach(b => b.addEventListener('click', () => {
        if (!isPixelArtOn()) setPixelArt(true);
        setPixelScope(b.dataset.scope);
        syncDialog(box);
      }));
      box.querySelectorAll('[data-pal]').forEach(b => b.addEventListener('click', () => {
        if (!isPixelArtOn()) setPixelArt(true);
        setPixelArtParams({ paletteMode: Number(b.dataset.pal) });
        syncDialog(box);
      }));
    },
    sync(box) {
      const sc = getPixelScope();
      const pal = getPixelArtParams().paletteMode;
      box.querySelectorAll('[data-scope]').forEach(b => b.classList.toggle('on', b.dataset.scope === sc));
      box.querySelectorAll('[data-pal]').forEach(b => b.classList.toggle('on', Number(b.dataset.pal) === pal));
    },
  },
  {
    id: 'crt',
    label: 'CRT',
    statusTitle: 'CRT OVERLAY STATUS (F9)',
    sliders: CRT_SLIDERS,
    isOn: isCrtOn,
    toggle: toggleCrt,
    getParams: getCrtParams,
    setParam: (k, v) => { if (!isCrtOn()) setCrt(true); setCrtParams({ [k]: v }); },
    reset: resetCrtParams,
  },
  {
    id: 'shade',
    label: 'SHADE',
    statusTitle: '3D FORM SHADE (F7)',
    sliders: [],
    isOn: () => !!CFG.FORM_SHADE,
    toggle: () => { setFormShade(!CFG.FORM_SHADE); syncOpen(); },
    getParams: () => ({}),
    setParam: () => {},
    reset: () => { setFormShade(true); syncOpen(); },
    headHtml() {
      return '<div class="pd-box"><div class="pd-note">Daytime half-Lambert sun wrap and 2 cm box edge creases on 3D road props, traffic, and landmarks. Fades smoothly into night.</div></div>';
    },
  },
];

let dlg = null;
let activeTab = readInitialTab();

function readInitialTab() {
  const saved = store.get(TAB_KEY, 'pixel');
  return TABS.some(t => t.id === saved) ? saved : 'pixel';
}

const activeSpec = () => TABS.find(t => t.id === activeTab) ?? TABS[0];

function sliderHtml(s) {
  return `
    <label class="pd-row">
      <span class="pd-lbl"><span>${s.label}</span><b data-val="${s.key}"></b></span>
      <input type="range" data-key="${s.key}" min="${s.min}" max="${s.max}" step="${s.step}" />
    </label>`;
}

function buildSlidersHtml(tab) {
  return (tab.headHtml?.() ?? '') + tab.sliders.map(sliderHtml).join('');
}

function buildDialogHtml() {
  const tabs = TABS.map(t =>
    `<button type="button" class="pd-tab" role="tab" data-tab="${t.id}" aria-selected="${t.id === activeTab}"><i class="pd-dot" data-dot="${t.id}"></i><span>${t.label}</span></button>`,
  ).join('');
  return `
    <div class="pd-head" id="pd-drag">
      <span class="pd-title"><i></i>VISUAL SHADER LAB</span>
      <span class="pd-sub">F8</span>
      <button type="button" class="pd-close" id="pd-close" title="Close (F8)">✕</button>
    </div>
    <div class="pd-body">
      <div class="pd-tabs" role="tablist">${tabs}</div>
      <div class="pd-top">
        <span class="pd-sub" id="pd-status-lbl">STATUS</span>
        <button type="button" class="pd-toggle" id="pd-enable" aria-pressed="false">OFF</button>
      </div>
      <div class="pd-sliders" id="pd-sliders">${buildSlidersHtml(activeSpec())}</div>
      <div class="pd-foot">
        <span class="pd-sub">HOTKEY: F8 · F9 CRT · F10 PIXEL · F7 SHADE</span>
        <button type="button" class="pd-reset" id="pd-reset">RESET</button>
      </div>
    </div>`;
}

function enableDragging(box, handle) {
  let dragging = false, ox = 0, oy = 0;
  handle.addEventListener('pointerdown', e => {
    if (e.target.closest('button')) return;
    dragging = true;
    const r = box.getBoundingClientRect();
    ox = e.clientX - r.left; oy = e.clientY - r.top;
    handle.setPointerCapture?.(e.pointerId);
  });
  handle.addEventListener('pointermove', e => {
    if (!dragging) return;
    const x = Math.max(8, Math.min(innerWidth - box.offsetWidth - 8, e.clientX - ox));
    const y = Math.max(8, Math.min(innerHeight - box.offsetHeight - 8, e.clientY - oy));
    box.style.left = `${x}px`; box.style.top = `${y}px`; box.style.bottom = 'auto';
  });
  handle.addEventListener('pointerup', () => { dragging = false; });
}

function bindSliderEvents(box) {
  box.querySelectorAll('#pd-sliders input[type=range]').forEach(inp => {
    inp.addEventListener('input', () => {
      const k = inp.dataset.key;
      if (k) activeSpec().setParam(k, parseFloat(inp.value));
    });
    inp.addEventListener('pointerup', () => inp.blur());
  });
  activeSpec().bind?.(box);
}

function syncDialog(box) {
  const spec = activeSpec(), on = spec.isOn(), p = spec.getParams();
  const lbl = box.querySelector('#pd-status-lbl');
  if (lbl) lbl.textContent = spec.statusTitle;
  const en = box.querySelector('#pd-enable');
  if (en) { en.setAttribute('aria-pressed', String(on)); en.textContent = on ? 'ACTIVE · ON' : 'BYPASSED · OFF'; }
  box.querySelectorAll('.pd-tab').forEach(b => {
    const act = b.dataset.tab === activeTab;
    b.classList.toggle('on', act);
    b.setAttribute('aria-selected', String(act));
  });
  for (const t of TABS) box.querySelector(`[data-dot="${t.id}"]`)?.classList.toggle('live', t.isOn());
  for (const s of spec.sliders) {
    const inp = box.querySelector(`input[data-key="${s.key}"]`);
    const val = box.querySelector(`[data-val="${s.key}"]`);
    const v = p[s.key] ?? 0;
    if (inp) inp.value = String(v);
    if (val) val.textContent = s.fmt(v);
  }
  spec.sync?.(box);
}

function syncOpen() {
  if (dlg?.classList.contains('open')) syncDialog(dlg);
}

export function selectVisualTab(tab) {
  if (!TABS.some(t => t.id === tab)) return;
  activeTab = tab;
  store.set(TAB_KEY, activeTab);
  if (!dlg) return;
  const host = dlg.querySelector('#pd-sliders');
  if (host) { host.innerHTML = buildSlidersHtml(activeSpec()); bindSliderEvents(dlg); }
  syncDialog(dlg);
}

export const isVisualLabOpen = () => !!dlg?.classList.contains('open');

export function toggleVisualLab(force) {
  initVisualLab();
  if (!dlg) return false;
  const open = force ?? !dlg.classList.contains('open');
  dlg.classList.toggle('open', open);
  if (open) syncDialog(dlg);
  return open;
}

export function initVisualLab() {
  if (typeof document === 'undefined' || !document.head || !document.body) return;
  if (document.getElementById('pixel-dlg')) return;
  document.head.insertAdjacentHTML('beforeend', `<style id="pixel-dlg-css">${CSS}</style>`);
  const box = dlg = document.createElement('div');
  box.id = 'pixel-dlg';
  box.setAttribute('role', 'dialog');
  box.setAttribute('aria-label', 'Visual shader lab');
  box.innerHTML = buildDialogHtml();
  document.body.appendChild(box);
  enableDragging(box, box.querySelector('#pd-drag'));
  box.querySelector('#pd-close')?.addEventListener('click', () => toggleVisualLab(false));
  box.querySelector('#pd-enable')?.addEventListener('click', () => { activeSpec().toggle(); syncDialog(box); });
  box.querySelector('#pd-reset')?.addEventListener('click', () => { activeSpec().reset(); syncDialog(box); });
  box.querySelectorAll('.pd-tab').forEach(b => b.addEventListener('click', () => selectVisualTab(b.dataset.tab)));
  bindSliderEvents(box);
  onPixelArtChange(syncOpen);
  onCrtChange(syncOpen);
  syncDialog(box);
  try {
    if (typeof location !== 'undefined' && new URLSearchParams(location.search).get('pixelDialog') === '1') toggleVisualLab(true);
  } catch { /* ignore */ }
}
