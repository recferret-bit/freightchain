import * as THREE from 'three';
import { canvasTex } from './scene.js';
import { buildInto } from './entity-build.js';

/* The finish gantry: entity `gantry` (two steel posts + a banner with the route's terminal name). Origin = centre of the road at ground level;
   used by chunks.js and the model viewer. The banner painter stays here – the entity only places it. */
export function buildGantry(finishText) {
  const gp = new THREE.Group();
  buildInto(gp, 'gantry', {}, {
    slot: () => null,
    banner(w, h, x, y, z) {
      const gantryTex = canvasTex(512, 96, (g, cw, ch) => { g.fillStyle = '#1d3a5c'; g.fillRect(0, 0, cw, ch); g.fillStyle = '#9fb4cc'; g.font = 'bold 22px monospace'; g.textAlign = 'center'; g.fillText('FREIGHTCHAIN TERMINAL', cw / 2, 30); g.fillStyle = '#ffcf5a'; g.font = 'bold 38px monospace'; g.fillText(finishText, cw / 2, 76); }, false);
      const banner = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map: gantryTex, side: THREE.DoubleSide, toneMapped: false })); banner.position.set(x, y, z); banner.userData.disposable = true; return banner;
    },
  });
  return gp;
}
