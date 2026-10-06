import * as THREE from 'three';

/* Renderer, scene, camera and the canvas-texture helper. Everything route-specific (sky, terrain, mountains, road look, props)
   lives in js/themes/ and is applied by world/environment.js. */

export const renderer = new THREE.WebGLRenderer({ canvas: document.getElementById('world'), antialias: true });
export const scene = new THREE.Scene();
export const camera = new THREE.PerspectiveCamera(60, 1, 0.3, 3500);
camera.rotation.order = 'YXZ';

export function canvasTex(w, h, draw, repeat = true) {
  const c = document.createElement('canvas'); c.width = w; c.height = h; draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8; return t;
}
