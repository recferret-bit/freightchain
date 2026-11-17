import * as THREE from 'three';
import { renderer } from './scene.js';
import { cv, view } from '../cockpit/canvas.js';
import { store, clamp } from '../util.js';

/* Post-process pixel-art pass ported from TerraAgent (`pixelArtPass.ts`):
   4x4 ordered Bayer dither, 1px silhouette ink + ridge highlights, discrete color quantization,
   optional retro palettes, and sub-pixel grid bevel. Supports two scopes:
   - 'world': Out of Cockpit (pixelates the 3D scene + mirrors; keeps the 2D cab crisp)
   - 'all': Whole Game (composites the 2D cockpit over the 3D scene before pixelation, plus #phone CSS filter) */

const KEY = 'freightchain.pixel';
const SCOPE_KEY = 'freightchain.pixel.scope';
const PARAMS_KEY = 'freightchain.pixel.params';

export const DEFAULT_PIXEL_PARAMS = Object.freeze({
  pixelSize: 3.5,
  colorLevels: 16,
  dither: 0.85,
  edgeStrength: 0.65,
  saturation: 1.16,
  contrast: 1.05,
  gridStrength: 0.05,
  paletteMode: 0, // 0 = Full RGB, 1 = GameBoy DMG, 2 = Amber CRT, 3 = Cyber Neon
});

const PIXEL_VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}`;

const BAYER_CHUNK = /* glsl */ `
float luma(vec3 c) {
  return dot(c, vec3(0.299, 0.587, 0.114));
}
float bayer2(vec2 a) {
  a = floor(a);
  return fract(a.x * 0.5 + a.y * a.y * 0.75);
}
float bayer4x4(vec2 cell) {
  vec2 p = floor(mod(cell, 4.0));
  return bayer2(0.5 * p) * 0.25 + bayer2(p);
}`;

const EDGE_CHUNK = /* glsl */ `
vec3 sampleScene(vec2 uv) {
  vec3 w = texture2D(tDiffuse, uv).rgb;
  if (uWholeGame < 0.5) return w;
  vec4 c = texture2D(tCockpit, uv);
  return clamp(w * (1.0 - c.a) + c.rgb, 0.0, 1.0);
}
vec3 samplePixelEdge(vec2 centerUv, vec2 texel, float edgeStrength) {
  vec3 c0 = sampleScene(centerUv);
  vec3 cN = sampleScene(centerUv + vec2(0.0, texel.y));
  vec3 cS = sampleScene(centerUv - vec2(0.0, texel.y));
  vec3 cE = sampleScene(centerUv + vec2(texel.x, 0.0));
  vec3 cW = sampleScene(centerUv - vec2(texel.x, 0.0));
  float l0 = luma(c0);
  float lN = luma(cN), lS = luma(cS), lE = luma(cE), lW = luma(cW);
  float maxL = max(max(lN, lS), max(lE, lW));
  float avgL = 0.25 * (lN + lS + lE + lW);
  float outline = smoothstep(0.10, 0.32, maxL - l0) * edgeStrength;
  float ridge = clamp((l0 - avgL) * 1.35, -0.06, 0.11) * edgeStrength;
  return clamp(c0 * (1.0 - outline * 0.42) + ridge, 0.0, 1.0);
}`;

const PALETTE_CHUNK = /* glsl */ `
vec3 applyPaletteMode(vec3 col, float qLuma, float mode) {
  if (mode < 0.5) return col;
  if (mode < 1.5) {
    vec3 c0 = vec3(0.06, 0.22, 0.06), c1 = vec3(0.19, 0.38, 0.19);
    vec3 c2 = vec3(0.55, 0.67, 0.06), c3 = vec3(0.72, 0.84, 0.16);
    return qLuma < 0.33 ? mix(c0, c1, qLuma * 3.0) : qLuma < 0.66 ? mix(c1, c2, (qLuma - 0.33) * 3.0) : mix(c2, c3, (qLuma - 0.66) * 3.0);
  }
  if (mode < 2.5) {
    return mix(vec3(0.05, 0.02, 0.0), vec3(1.0, 0.68, 0.12), qLuma);
  }
  return qLuma < 0.5 ? mix(vec3(0.04, 0.03, 0.12), vec3(0.12, 0.42, 0.98), qLuma * 2.0)
                     : mix(vec3(0.12, 0.42, 0.98), vec3(1.0, 0.38, 0.72), (qLuma - 0.5) * 2.0);
}`;

const QUANTIZE_CHUNK = /* glsl */ `
vec3 quantizePixelArt(vec3 col, vec2 cell, vec2 subUv, float levels, float ditherAmt, float sat, float con, float pixelSize, float gridStr, float mode) {
  col = clamp((col - 0.5) * con + 0.5, 0.0, 1.0);
  float lum = luma(col);
  col = clamp(mix(vec3(lum), col, sat), 0.0, 1.0);
  float dither = (bayer4x4(cell) - 0.46875) * (ditherAmt / levels);
  col = clamp(col + dither, 0.0, 1.0);
  col = floor(col * levels + 0.5) / levels;
  float qLuma = floor(clamp(lum + dither, 0.0, 1.0) * levels + 0.5) / levels;
  col = applyPaletteMode(col, qLuma, mode);
  float border = step(1.0 - 1.0 / max(pixelSize, 2.0), max(subUv.x, subUv.y));
  return col * (1.0 - border * gridStr);
}`;

const PIXEL_MAIN = /* glsl */ `
uniform vec2 uResolution;
uniform float uPixelSize;
uniform float uColorLevels;
uniform float uDither;
uniform float uEdgeStrength;
uniform float uSaturation;
uniform float uContrast;
uniform float uGridStrength;
uniform float uPaletteMode;
varying vec2 vUv;

void main() {
  vec2 grid = max(floor(uResolution / max(uPixelSize, 1.0)), vec2(1.0));
  vec2 cell = floor(vUv * grid);
  vec2 subUv = fract(vUv * grid);
  vec2 centerUv = (cell + 0.5) / grid;
  vec2 texel = 1.0 / grid;
  vec3 col = samplePixelEdge(centerUv, texel, uEdgeStrength);
  col = quantizePixelArt(col, cell, subUv, uColorLevels, uDither, uSaturation, uContrast, uPixelSize, uGridStrength, uPaletteMode);
  gl_FragColor = vec4(col, 1.0);
}`;

const PIXEL_FRAG = [
  'uniform sampler2D tDiffuse;',
  'uniform sampler2D tCockpit;',
  'uniform float uWholeGame;',
  BAYER_CHUNK,
  EDGE_CHUNK,
  PALETTE_CHUNK,
  QUANTIZE_CHUNK,
  PIXEL_MAIN,
].join('\n');

function readInitialEnabled() {
  try {
    if (typeof location !== 'undefined') {
      const q = new URLSearchParams(location.search).get('pixel');
      if (q === '1' || q === 'true') return true;
      if (q === '0' || q === 'false') return false;
    }
  } catch { /* ignore */ }
  return store.get(KEY, '1') !== '0';
}

function readInitialScope() {
  try {
    if (typeof location !== 'undefined') {
      const q = new URLSearchParams(location.search).get('pixelScope');
      if (q === 'all' || q === 'world') return q;
    }
  } catch { /* ignore */ }
  const saved = store.get(SCOPE_KEY, 'world');
  return saved === 'all' ? 'all' : 'world';
}

function readInitialParams() {
  const saved = store.getJSON(PARAMS_KEY, null);
  if (!saved || typeof saved !== 'object') return { ...DEFAULT_PIXEL_PARAMS };
  return {
    pixelSize: clamp(Number(saved.pixelSize ?? DEFAULT_PIXEL_PARAMS.pixelSize), 1, 12),
    colorLevels: clamp(Number(saved.colorLevels ?? DEFAULT_PIXEL_PARAMS.colorLevels), 2, 64),
    dither: clamp(Number(saved.dither ?? DEFAULT_PIXEL_PARAMS.dither), 0, 2),
    edgeStrength: clamp(Number(saved.edgeStrength ?? DEFAULT_PIXEL_PARAMS.edgeStrength), 0, 2),
    saturation: clamp(Number(saved.saturation ?? DEFAULT_PIXEL_PARAMS.saturation), 0, 2.5),
    contrast: clamp(Number(saved.contrast ?? DEFAULT_PIXEL_PARAMS.contrast), 0.5, 2.0),
    gridStrength: clamp(Number(saved.gridStrength ?? DEFAULT_PIXEL_PARAMS.gridStrength), 0, 0.35),
    paletteMode: clamp(Math.round(Number(saved.paletteMode ?? DEFAULT_PIXEL_PARAMS.paletteMode)), 0, 3),
  };
}

let on = readInitialEnabled();
let scope = readInitialScope();
let params = readInitialParams();
const listeners = new Set();

function syncScopeDom() {
  if (typeof document === 'undefined' || !document.body) return;
  const whole = on && scope === 'all';
  document.body.classList?.toggle?.('pixel-whole', whole);
  if (cv?.style) cv.style.opacity = whole ? '0' : '';
}

const notify = () => {
  syncScopeDom();
  listeners.forEach(fn => fn(on, params, scope));
};

export const isPixelArtOn = () => on;
export const getPixelScope = () => scope;
export const getPixelArtParams = () => ({ ...params });
export const onPixelArtChange = fn => {
  listeners.add(fn);
  return () => listeners.delete(fn);
};

export function setPixelArt(v) {
  on = !!v;
  store.set(KEY, on ? '1' : '0');
  notify();
  return on;
}

export const togglePixelArt = () => setPixelArt(!on);

export function setPixelScope(next) {
  scope = next === 'all' ? 'all' : 'world';
  store.set(SCOPE_KEY, scope);
  notify();
  return scope;
}

export function setPixelArtParams(next) {
  params = { ...params, ...next };
  params.paletteMode = clamp(Math.round(Number(params.paletteMode ?? 0)), 0, 3);
  store.set(PARAMS_KEY, params);
  notify();
  return { ...params };
}

export const resetPixelArtParams = () => {
  setPixelScope('world');
  return setPixelArtParams({ ...DEFAULT_PIXEL_PARAMS });
};

let fbTex = null, fbW = 0, fbH = 0;
let cockpitTex = null, cabW = 0, cabH = 0;
let quadScene = null, quadCam = null, quadMat = null;
const ZERO = new THREE.Vector2(0, 0);

function ensureQuad() {
  if (quadScene) return;
  quadScene = new THREE.Scene();
  quadCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  quadMat = new THREE.ShaderMaterial({
    uniforms: {
      tDiffuse: { value: null },
      tCockpit: { value: null },
      uWholeGame: { value: 0 },
      uResolution: { value: new THREE.Vector2(1, 1) },
      uPixelSize: { value: params.pixelSize },
      uColorLevels: { value: params.colorLevels },
      uDither: { value: params.dither },
      uEdgeStrength: { value: params.edgeStrength },
      uSaturation: { value: params.saturation },
      uContrast: { value: params.contrast },
      uGridStrength: { value: params.gridStrength },
      uPaletteMode: { value: params.paletteMode },
    },
    vertexShader: PIXEL_VERT,
    fragmentShader: PIXEL_FRAG,
    depthTest: false,
    depthWrite: false,
    toneMapped: false,
  });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), quadMat);
  mesh.frustumCulled = false;
  quadScene.add(mesh);
}

export function renderPixelPass() {
  syncScopeDom();
  if (!on) return;
  if (typeof window === 'undefined' || !window.WebGLRenderingContext) return;
  const { W, H, DPR } = view;
  if (!W || !H) return;
  const gl = renderer.getContext?.();
  const bufW = Math.max(1, gl?.drawingBufferWidth || renderer.domElement?.width || Math.floor(W * DPR));
  const bufH = Math.max(1, gl?.drawingBufferHeight || renderer.domElement?.height || Math.floor(H * DPR));
  if (!fbTex || fbW !== bufW || fbH !== bufH) {
    fbTex?.dispose();
    fbTex = new THREE.FramebufferTexture(bufW, bufH);
    fbTex.minFilter = THREE.LinearFilter;
    fbTex.magFilter = THREE.LinearFilter;
    fbTex.generateMipmaps = false;
    fbTex.colorSpace = THREE.NoColorSpace;
    fbW = bufW;
    fbH = bufH;
  }
  const whole = scope === 'all';
  if (whole && cv && cv.width > 0 && cv.height > 0) {
    if (!cockpitTex || cabW !== cv.width || cabH !== cv.height) {
      cockpitTex?.dispose();
      cockpitTex = new THREE.CanvasTexture(cv);
      cockpitTex.premultiplyAlpha = true;
      cockpitTex.minFilter = THREE.LinearFilter;
      cockpitTex.magFilter = THREE.LinearFilter;
      cockpitTex.generateMipmaps = false;
      cockpitTex.colorSpace = THREE.NoColorSpace;
      cabW = cv.width;
      cabH = cv.height;
    }
    cockpitTex.needsUpdate = true;
  }
  ensureQuad();
  const u = quadMat.uniforms;
  u.tDiffuse.value = fbTex;
  u.tCockpit.value = whole && cockpitTex ? cockpitTex : fbTex;
  u.uWholeGame.value = whole && cockpitTex ? 1 : 0;
  u.uResolution.value.set(bufW, bufH);
  u.uPixelSize.value = params.pixelSize;
  u.uColorLevels.value = params.colorLevels;
  u.uDither.value = params.dither;
  u.uEdgeStrength.value = params.edgeStrength;
  u.uSaturation.value = params.saturation;
  u.uContrast.value = params.contrast;
  u.uGridStrength.value = params.gridStrength;
  u.uPaletteMode.value = params.paletteMode;

  renderer.setRenderTarget?.(null);
  renderer.setScissorTest(false);
  renderer.setViewport(0, 0, W, H);
  if (Number(THREE.REVISION || 160) >= 165) renderer.copyFramebufferToTexture(fbTex, ZERO);
  else renderer.copyFramebufferToTexture(ZERO, fbTex);

  const prevAutoClear = renderer.autoClear;
  renderer.autoClear = false;
  try {
    renderer.render(quadScene, quadCam);
  } finally {
    renderer.autoClear = prevAutoClear;
  }
}
