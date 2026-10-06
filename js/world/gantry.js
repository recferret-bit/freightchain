import * as THREE from 'three';
import { canvasTex } from './scene.js';
import { GEO, MAT, mk } from './props.js';

/* The finish gantry (two steel posts + banner with the route's terminal name). Origin = centre of the road at ground level; used by chunks.js and the model viewer. */
export function buildGantry(finishText) {
  const gantryTex = canvasTex(512, 96, (g, w, h) => { g.fillStyle = '#1d3a5c'; g.fillRect(0, 0, w, h); g.fillStyle = '#9fb4cc'; g.font = 'bold 22px monospace'; g.textAlign = 'center'; g.fillText('FREIGHTCHAIN TERMINAL', w / 2, 30); g.fillStyle = '#ffcf5a'; g.font = 'bold 38px monospace'; g.fillText(finishText, w / 2, 76); }, false);
  const gp = new THREE.Group();
  gp.add(mk(GEO.box, MAT.steel, 0.5, 7, 0.5, -7.2, 3.5, 0)); gp.add(mk(GEO.box, MAT.steel, 0.5, 7, 0.5, 7.2, 3.5, 0));
  const banner = new THREE.Mesh(new THREE.PlaneGeometry(14.4, 2.7), new THREE.MeshBasicMaterial({ map: gantryTex, side: THREE.DoubleSide, toneMapped: false })); banner.position.set(0, 6.2, 0); banner.userData.disposable = true; gp.add(banner);
  return gp;
}
