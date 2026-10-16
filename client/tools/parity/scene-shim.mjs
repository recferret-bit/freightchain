// Replaces js/world/scene.js in the parity bundles: no WebGL, and canvasTex records every 2D-context call so a painted texture compares by its drawing.
import * as THREE from 'three';
export const renderer = new THREE.WebGLRenderer();
export const scene = new THREE.Scene();
export const camera = new THREE.PerspectiveCamera(60, 1, 0.3, 3500);
export function recordingContext(log) {
  let px = 10;
  return new Proxy({}, {
    get: (_t, p) => (p === 'measureText' ? text => ({ width: String(text).length * px * .55 }) : p === 'createLinearGradient' || p === 'createRadialGradient' ? (...a) => { log.push([p, ...a]); return { addColorStop: (...b) => log.push(['stop', ...b]) }; } : (...a) => log.push([p, ...a])),
    set: (_t, p, v) => { if (p === 'font') { const m = /(\d+)px/.exec(v); if (m) px = +m[1]; } log.push(['=' + String(p), typeof v === 'object' ? '[obj]' : v]); return true; },
  });
}
export function canvasTex(w, h, draw, repeat = true) {
  const log = [['size', w, h]];
  draw(recordingContext(log), w, h);
  const t = new THREE.CanvasTexture({ log }); t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8; return t;
}
