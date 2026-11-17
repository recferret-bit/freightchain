import * as THREE from 'three';
import { GEO, mk } from './props.js';
import { group, mesh } from './pool.js';
import { canvasTex } from './scene.js';
import { net } from '../net/network.js';

/* The depot the ride starts from: a concrete yard, a warehouse with loading docks right behind the truck (the cargo has just been loaded), two trailers
   still parked at the docks, and the exit sign + speed limit on the access road. Route-independent; built with chunk 0 (world/chunks.js).
   Spine coordinates: the truck's eye starts at s = 0, its trailer ends at ≈ -14.7, the dock face is at s = -18. */
const M = {
  yard: new THREE.MeshBasicMaterial({ color: 0x8c8880 }), wall: new THREE.MeshBasicMaterial({ color: 0xb4b8bb }), roof: new THREE.MeshBasicMaterial({ color: 0x5f6468 }),
  door: new THREE.MeshBasicMaterial({ color: 0x3b4148 }), dock: new THREE.MeshBasicMaterial({ color: 0x1e1f21 }), stripe: new THREE.MeshBasicMaterial({ color: 0xf2c230 }),
  trailer: new THREE.MeshBasicMaterial({ color: 0xe9e7df }), band: new THREE.MeshBasicMaterial({ color: 0x1d3a5c }), wheel: new THREE.MeshBasicMaterial({ color: 0x151515 }),
  post: new THREE.MeshBasicMaterial({ color: 0x6a6f74 }),
};
export const depotMats = Object.values(M);
const signMat = (w, h, draw) => new THREE.MeshBasicMaterial({ side: THREE.DoubleSide, map: canvasTex(w, h, draw, false) });
const NAME = signMat(512, 96, (g, w, h) => { g.fillStyle = '#1d3a5c'; g.fillRect(0, 0, w, h); g.fillStyle = '#ffcf5a'; g.font = 'bold 54px monospace'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('FREIGHTCHAIN DEPOT', w / 2, h / 2 + 3); });
const exitSign = (way, note) => signMat(256, 160, (g, w, h) => {
  g.fillStyle = '#1d3a5c'; g.fillRect(0, 0, w, h); g.strokeStyle = '#f4f4f0'; g.lineWidth = 6; g.strokeRect(6, 6, w - 12, h - 12);
  g.fillStyle = '#f4f4f0'; g.textAlign = 'center'; g.font = 'bold 30px sans-serif'; g.fillText('FREIGHTCHAIN', w / 2, 48); g.font = 'bold 22px sans-serif'; g.fillText(way, w / 2, 92); g.fillText(note, w / 2, 128);
});
const EXIT = exitSign('MAIN ROAD →', 'DRIVE SLOWLY'), EXIT_AHEAD = exitSign('↑ MAIN ROAD', 'STRAIGHT ON');   // EXIT_AHEAD: a straight start (trips.js), no turn
const LIMIT = signMat(128, 160, (g, w, h) => {
  g.fillStyle = '#f4f4f0'; g.fillRect(0, 0, w, h); g.strokeStyle = '#111'; g.lineWidth = 6; g.strokeRect(6, 6, w - 12, h - 12);
  g.fillStyle = '#111'; g.textAlign = 'center'; g.font = 'bold 22px sans-serif'; g.fillText('SPEED', w / 2, 38); g.fillText('LIMIT', w / 2, 62); g.font = 'bold 64px sans-serif'; g.fillText('15', w / 2, 130);
});
const PLANE = new THREE.PlaneGeometry(1, 1);
const plane = (mat, w, h, x, y, z, ry = 0) => { const p = mesh(PLANE, mat); p.scale.set(w, h, 1); p.position.set(x, y, z); p.rotation.y = ry; return p; };

/* model frame = spine frame at s = 0: x = lat (right), z = -s (the road runs along -z) */
function trailer(g, x, z) {
  g.add(mk(GEO.rbox, M.trailer, 2.56, 2.8, 13.4, x, 2.65, z));
  g.add(mk(GEO.box, M.band, 2.6, .48, 13.44, x, 2.05, z));
  g.add(mk(GEO.box, M.stripe, 2.61, .1, 13.45, x, 1.32, z));
  g.add(mk(GEO.rbox, M.post, 1.85, 1.6, .42, x, 2.8, z - 6.85));   // front reefer unit facing out from dock
  g.add(mk(GEO.box, M.dock, 2.1, .52, 10.6, x, 1.04, z + .8));
  for (const dz of [4.6, 5.9]) {
    const ax = mk(GEO.cyl16, M.dock, .09, 1.96, .09, x, .5, z + dz); ax.rotation.z = Math.PI / 2; g.add(ax);
    for (const dx of [-.98, .98]) {
      const w = mk(GEO.wheel20, M.wheel, .5, .35, .5, x + dx, .5, z + dz); w.rotation.z = Math.PI / 2; g.add(w);
      const r = mk(GEO.wheel20, M.post, .3, .37, .3, x + dx + Math.sign(dx) * .01, .5, z + dz); r.rotation.z = Math.PI / 2; g.add(r);
    }
  }
  for (const dx of [-.9, .9]) { g.add(mk(GEO.box, M.post, .14, 1.28, .14, x + dx, .66, z - 4.5)); g.add(mk(GEO.box, M.dock, .34, .06, .34, x + dx, .03, z - 4.5)); }
  g.add(mk(GEO.rbox, M.dock, 2.25, .16, .14, x, .58, z + 6.66));   // rear underride guard
  for (const dx of [-.75, .75]) g.add(mk(GEO.box, M.dock, .12, .76, .12, x + dx, .92, z + 6.62));
}
/* place(obj, s, lat, yaw) / reg(obj, id, s, lat, extra) = chunks.js raw placement (no roadside shift, no keep-out) */
export function buildDepot({ place, reg, destroyed }) {
  const g = group();
  g.add(mk(GEO.box, M.yard, 64, .02, 80, 0, .01, 15));   // yard s -55..25
  const W = 66, D = 40, H = 10, z0 = 18 + D / 2;   // warehouse: front (dock face) at s = -18
  g.add(mk(GEO.box, M.wall, W, H, D, 0, H / 2, z0));
  g.add(mk(GEO.box, M.dock, W + .2, 1.1, D + .2, 0, .55, z0));   // concrete dado plinth
  g.add(mk(GEO.box, M.band, W + .3, .9, D + .3, 0, H - .8, z0)); // upper fascia band
  g.add(mk(GEO.box, M.roof, W + 1.2, .55, D + 1.2, 0, H + .25, z0));
  for (const rx of [-18, 0, 18]) g.add(mk(GEO.rbox, M.post, 4.2, 1.4, 3.2, rx, H + 1.1, z0 - 6));   // rooftop HVAC units
  for (const x of [-26, -12.6, 2.4, 15.8, 28]) {   // dock doors + weather-seal canopies + bollards; truck starts from lat 2.4
    g.add(mk(GEO.box, M.door, 3.4, 3.6, .2, x, 3.1, 18));
    g.add(mk(GEO.rbox, M.roof, 4.4, .28, 1.6, x, 5.15, 17.3));   // dock canopy hood
    g.add(mk(GEO.box, M.dock, 4.2, 1.3, .65, x, .65, 17.8));
    for (const dx of [-1.75, 1.75]) {
      g.add(mk(GEO.box, M.dock, .32, 3.8, .35, x + dx, 3.1, 17.9));   // rubber dock seal pads
      g.add(mk(GEO.cyl16, M.stripe, .14, 1.05, .14, x + dx, .52, 17.25));   // yellow steel bollards
    }
  }
  g.add(mk(GEO.rbox, M.dock, 14.2, 2.76, .08, 0, 7.3, 17.96));
  g.add(plane(NAME, 14, 2.6, 0, 7.3, 17.9, Math.PI));   // faces the yard (seen in the mirrors)
  g.userData = { kind: 'building', size: 1, debris: M.wall };
  place(g, 0, 0, undefined); reg(g, 'depot', -38, 0, { rf: D / 2, rl: W / 2 });
  for (const [k, x] of [[0, -12.6], [1, 15.8]]) {   // trailers still at the docks
    const id = 'depot:t' + k; if (destroyed.has(id)) continue;
    const t = group(); trailer(t, 0, 0); t.userData = { kind: 'building', size: 1, debris: M.trailer };
    place(t, -10.8, x); reg(t, id, -10.8, x, { rf: 6.7, rl: 1.3 });
  }
  for (const [id, s, lat, mat, w, h, ph] of [['depot:exit', 26, 6.4, net.straight ? EXIT_AHEAD : EXIT, 2.6, 1.6, 2.4], ['depot:limit', 40, 5.8, LIMIT, .8, 1, 2]]) {   // signs on the access road
    if (destroyed.has(id)) continue;
    const sg = group(), top = ph + h * .38;
    sg.add(mk(GEO.oct, M.dock, .28, .18, .28, 0, .09, 0));
    sg.add(mk(GEO.cyl16, M.post, .06, top, .06, 0, top / 2, 0));
    sg.add(mk(GEO.box, M.post, Math.min(w * .65, 1.6), .1, .05, 0, ph, .05));
    sg.add(mk(GEO.rbox, M.dock, w + .08, h + .08, .05, 0, ph, .09));
    sg.add(plane(mat, w, h, 0, ph, .125));
    sg.userData = { kind: 'sign', size: 1, debris: M.post }; place(sg, s, lat); reg(sg, id, s, lat);
  }
}
