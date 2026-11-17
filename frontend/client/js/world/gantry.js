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
      const gantryTex = canvasTex(1024, 192, (g, cw, ch) => {
        g.fillStyle = '#16324f'; g.fillRect(0, 0, cw, ch);
        g.fillStyle = 'rgba(255,255,255,.07)'; g.fillRect(0, 0, cw, 16);
        g.fillStyle = 'rgba(0,0,0,.2)'; g.fillRect(0, ch - 16, cw, 16);
        g.strokeStyle = '#e8eef5'; g.lineWidth = 6; g.strokeRect(8, 8, cw - 16, ch - 16);
        g.strokeStyle = '#9fb4cc'; g.lineWidth = 2; g.strokeRect(16, 16, cw - 32, ch - 32);
        g.fillStyle = '#c8d6e6';
        for (const rx of [28, cw / 2, cw - 28]) for (const ry of [28, ch - 28]) { g.beginPath(); g.arc(rx, ry, 3.5, 0, Math.PI * 2); g.fill(); }
        g.fillStyle = '#b7cce2'; g.font = 'bold 34px monospace'; g.textAlign = 'center'; g.fillText('FREIGHTCHAIN TERMINAL', cw / 2, 58);
        let px = 78; do g.font = `bold ${px -= 4}px sans-serif`; while (px > 34 && g.measureText(finishText).width > cw - 80);
        g.fillStyle = 'rgba(0,0,0,.35)'; g.fillText(finishText, cw / 2 + 3, 138);
        g.fillStyle = '#ffcf5a'; g.fillText(finishText, cw / 2, 135);
      }, false);
      const banner = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map: gantryTex, side: THREE.DoubleSide, toneMapped: false })); banner.position.set(x, y, z); banner.userData.disposable = true; return banner;
    },
  });
  return gp;
}
