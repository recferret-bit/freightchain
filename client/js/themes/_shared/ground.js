import * as THREE from 'three';
import { canvasTex } from '../../world/scene.js';
import { trackMat } from './mats.js';

/* Flat terrain plane that follows the camera; the texture offset keeps the pattern fixed in the world so it scrolls past as you drive.
   draw(g, w, h): paints one repeating tile on a 2D canvas context. tile = metres per texture repeat. */
export function createGround({ draw, size = 3000, tile = 12, texSize = 256 }) {
  const tex = canvasTex(texSize, texSize, draw), rep = size / tile; tex.repeat.set(rep, rep);
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(size, size), trackMat(new THREE.MeshBasicMaterial({ map: tex })));
  mesh.rotation.x = -Math.PI / 2;
  return { mesh, update(px, pz) { mesh.position.set(px, 0, pz); tex.offset.set(px / tile, -pz / tile); } };
}
