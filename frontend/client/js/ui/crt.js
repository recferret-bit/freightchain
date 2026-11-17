import { store } from '../util.js';

/* Old-TV / VHS overlay ported from TerraAgent (`ui/crt.ts`): crawling scanlines, rolling band,
   tape grain noise, soft flicker, tube vignette, and periodic sideways glitch wave.
   Uses a private PRNG so headless-test's global Math.random() trace never shifts. */

const KEY = 'freightchain.crt';
const PARAMS_KEY = 'freightchain.crt.params';

export const DEFAULT_CRT_PARAMS = Object.freeze({
  scanlineIntensity: 0.18,
  linePitch: 3,
  crawlSpeed: 0.9,
  rollIntensity: 0.045,
  rollSpeed: 8.0,
  noiseOpacity: 0.05,
  flickerStrength: 0.05,
  vignetteStrength: 0.50,
  waveAmplitude: 14,
  waveFrequency: 0.012,
  waveInterval: 22,
});

const NOISE = `url("data:image/svg+xml,${encodeURIComponent(`<svg xmlns='http://www.w3.org/2000/svg' width='160' height='160'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='.9' numOctaves='2' stitchTiles='stitch'/><feColorMatrix values='0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  0 0 0 .9 0'/></filter><rect width='160' height='160' filter='url(%23n)'/></svg>`)}")`;

const CSS = `
:root{
  --crt-line:3px;--crt-line-gap:2px;--crt-scan:0.18;--crt-crawl-s:0.9s;
  --crt-roll:0.045;--crt-roll-s:8s;--crt-noise:0.05;--crt-flicker:0.05;--crt-flicker-sub:0.03;--crt-vignette:0.5;
}
.crt{position:fixed;inset:0;z-index:1;pointer-events:none;overflow:hidden}
.crt i{position:absolute;inset:0;display:block;will-change:transform,opacity}
.crt .scan{inset:calc(-1 * var(--crt-line)) 0 0;background:repeating-linear-gradient(0deg,#0000 0 var(--crt-line-gap),rgba(0,0,0,var(--crt-scan)) var(--crt-line-gap) var(--crt-line));animation:crt-crawl var(--crt-crawl-s) linear infinite}
.crt .roll{top:-30%;height:30%;background:linear-gradient(0deg,#0000,rgba(255,255,255,var(--crt-roll)) 55%,#0000);animation:crt-roll var(--crt-roll-s) linear infinite}
.crt .noise{inset:-160px;background:${NOISE};opacity:var(--crt-noise);animation:crt-noise .5s steps(5,end) infinite}
.crt .vig{background:radial-gradient(ellipse at 50% 52%,#0000 55%,rgba(0,0,0,var(--crt-vignette)) 100%)}
.crt .fl{background:#000;opacity:0;animation:crt-flicker 3.7s ease-in-out infinite}
body.crt-off .crt{display:none}
body.pixel-whole #phone .phone-screen{filter:url(#pixel-svg-filter);image-rendering:pixelated}
@keyframes crt-crawl{to{transform:translateY(var(--crt-line))}}
@keyframes crt-roll{to{transform:translateY(433%)}}
@keyframes crt-noise{0%{transform:translate(0,0)}20%{transform:translate(-37px,23px)}40%{transform:translate(41px,-60px)}60%{transform:translate(-70px,-19px)}80%{transform:translate(28px,52px)}100%{transform:translate(0,0)}}
@keyframes crt-flicker{0%,100%{opacity:0}18%{opacity:var(--crt-flicker)}22%{opacity:0}61%{opacity:0}64%{opacity:var(--crt-flicker-sub)}70%{opacity:0}}
@media (prefers-reduced-motion:reduce){.crt i{animation:none}.crt .roll,.crt .noise,.crt .fl{display:none}}`;

const LEVELS = '0 0.08 0.17 0.25 0.33 0.42 0.5 0.58 0.67 0.75 0.83 0.92 1';
const SVGS = `<svg width="0" height="0" style="position:absolute" aria-hidden="true"><filter id="crt-wave" x="0" y="0" width="100%" height="100%" color-interpolation-filters="sRGB"><feTurbulence type="fractalNoise" baseFrequency="0 ${DEFAULT_CRT_PARAMS.waveFrequency}" numOctaves="1" seed="3" result="n"/><feComponentTransfer in="n" result="opaque"><feFuncA type="discrete" tableValues="1"/></feComponentTransfer><feOffset in="opaque" dy="0" result="shifted"/><feFlood flood-color="#808080" result="mid"/><feComposite in="shifted" in2="mid" operator="over" result="filled"/><feColorMatrix in="filled" type="matrix" values="1 0 0 0 0  0 0 0 0 0.5  0 0 0 0 0.5  0 0 0 0 1" result="map"/><feDisplacementMap in="SourceGraphic" in2="map" scale="0" xChannelSelector="R" yChannelSelector="G"/></filter><filter id="pixel-svg-filter" x="0" y="0" width="100%" height="100%" color-interpolation-filters="sRGB"><feFlood x="0" y="0" height="1" width="1"/><feComposite width="2" height="2"/><feTile result="t"/><feComposite in="SourceGraphic" in2="t" operator="in"/><feMorphology operator="dilate" radius="1" result="px"/><feComponentTransfer in="px"><feFuncR type="discrete" tableValues="${LEVELS}"/><feFuncG type="discrete" tableValues="${LEVELS}"/><feFuncB type="discrete" tableValues="${LEVELS}"/></feComponentTransfer></filter></svg>`;

let rngState = 0x9e3779b9;
const crtRand = () => ((rngState = (rngState * 1664525 + 1013904223) >>> 0) / 4294967296);
const rnd = ([a, b]) => a + crtRand() * (b - a);

function readInitialOn() {
  try {
    if (typeof location !== 'undefined') {
      const q = new URLSearchParams(location.search).get('crt');
      if (q === '1' || q === 'true') return true;
      if (q === '0' || q === 'false') return false;
    }
  } catch { /* ignore */ }
  return store.get(KEY, '1') !== '0';
}

function readInitialParams() {
  const saved = store.getJSON(PARAMS_KEY, null);
  return saved && typeof saved === 'object' ? { ...DEFAULT_CRT_PARAMS, ...saved } : { ...DEFAULT_CRT_PARAMS };
}

let on = readInitialOn();
let params = readInitialParams();
let waving = false;
let timer = 0;
const listeners = new Set();

function applyCrtCssVars() {
  if (typeof document === 'undefined' || !document.documentElement?.style) return;
  const r = document.documentElement.style;
  const pitch = Math.max(2, Math.round(params.linePitch));
  r.setProperty('--crt-line', `${pitch}px`);
  r.setProperty('--crt-line-gap', `${pitch - 1}px`);
  r.setProperty('--crt-scan', params.scanlineIntensity.toFixed(3));
  r.setProperty('--crt-crawl-s', `${Math.max(0.1, params.crawlSpeed).toFixed(2)}s`);
  r.setProperty('--crt-roll', params.rollIntensity.toFixed(3));
  r.setProperty('--crt-roll-s', `${Math.max(0.5, params.rollSpeed).toFixed(2)}s`);
  r.setProperty('--crt-noise', params.noiseOpacity.toFixed(3));
  r.setProperty('--crt-flicker', params.flickerStrength.toFixed(3));
  r.setProperty('--crt-flicker-sub', (params.flickerStrength * 0.6).toFixed(3));
  r.setProperty('--crt-vignette', params.vignetteStrength.toFixed(3));
  const turb = document.querySelector?.('#crt-wave feTurbulence');
  if (turb) turb.setAttribute('baseFrequency', `0 ${params.waveFrequency}`);
}

function wave() {
  if (typeof document === 'undefined') return;
  const f = document.getElementById('crt-wave');
  const off = f?.querySelector('feOffset'), dm = f?.querySelector('feDisplacementMap');
  const els = ['#world', '#cockpit', '#phone .phone-screen'].map(s => document.querySelector?.(s)).filter(Boolean);
  if (!on || waving || document.hidden || !dm || !off || !els.length || params.waveAmplitude <= 0) return;
  waving = true;
  const dur = rnd([0.5, 0.9]) * 1000, t0 = performance.now(), speed = rnd([300, 700]), amp = params.waveAmplitude * rnd([0.6, 1]);
  const prev = els.map(e => e.style.filter);
  const whole = document.body.classList.contains('pixel-whole');
  els.forEach((e, i) => {
    const cssPixel = whole && e.classList?.contains('phone-screen') ? 'url(#pixel-svg-filter)' : '';
    const base = prev[i] && prev[i] !== 'none' ? prev[i] : cssPixel;
    e.style.filter = base ? `${base} url(#crt-wave)` : 'url(#crt-wave)';
  });
  const step = now => {
    const p = Math.min(1, (now - t0) / dur);
    dm.setAttribute('scale', (amp * Math.sin(Math.PI * p) ** 2).toFixed(2));
    off.setAttribute('dy', ((p * speed * dur) / 1000).toFixed(1));
    if (p < 1 && on) { requestAnimationFrame(step); return; }
    els.forEach((e, i) => { e.style.filter = prev[i]; });
    waving = false;
  };
  step(t0);
}

const schedule = () => {
  if (typeof document === 'undefined' || !document.head) return;
  clearTimeout(timer);
  const avg = Math.max(2, params.waveInterval);
  timer = setTimeout(() => { wave(); schedule(); }, rnd([avg * 0.65, avg * 1.35]) * 1000);
};

const apply = () => {
  if (typeof document !== 'undefined' && document.body?.classList) {
    document.body.classList.toggle('crt-off', !on);
    applyCrtCssVars();
  }
  listeners.forEach(fn => fn(on, params));
};

export function setCrt(v) {
  on = !!v;
  store.set(KEY, on ? '1' : '0');
  apply();
  return on;
}

export const toggleCrt = () => setCrt(!on);
export const isCrtOn = () => on;
export const getCrtParams = () => ({ ...params });
export const onCrtChange = fn => {
  listeners.add(fn);
  return () => listeners.delete(fn);
};

export function setCrtParams(next) {
  params = { ...params, ...next };
  store.set(PARAMS_KEY, params);
  if (next.waveInterval !== undefined) schedule();
  apply();
  return { ...params };
}

export const resetCrtParams = () => setCrtParams({ ...DEFAULT_CRT_PARAMS });

export function initCrt() {
  if (typeof document === 'undefined' || !document.head || !document.body) return;
  if (document.getElementById('crt-css')) return;
  document.head.insertAdjacentHTML('beforeend', `<style id="crt-css">${CSS}</style>`);
  const el = document.createElement('div');
  el.className = 'crt';
  el.setAttribute('aria-hidden', 'true');
  el.innerHTML = '<i class="noise"></i><i class="roll"></i><i class="scan"></i><i class="vig"></i><i class="fl"></i>';
  document.body.appendChild(el);
  const reducedMotion = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion:reduce)').matches;
  if (!reducedMotion) {
    document.body.insertAdjacentHTML('beforeend', SVGS);
    schedule();
  }
  apply();
}
