import * as THREE from 'three';
import { roadAt } from '../road.js';
import { net, edgeOf, SHOULDER } from '../net/network.js';
import { GEO, MAT, mk } from './props.js';
import { group, mesh } from './pool.js';
import { canvasTex } from './scene.js';
import { glow } from './glow.js';
import { strip, bar, markLines, surfCols, spineStations, mainStations, lineStations } from './roadmesh.js';

/* Junctions as built objects: apron, side roads (straight, SIDE_LEN m each way, unmarked shoulders), stop lines, traffic-light masts and STOP signs;
   for the start junction the main road behind the turn. Built with the chunk that contains j.s (world/chunks.js), recycled with it.
   Traffic lights: one mast per approach on the far-right corner with a head over its lanes + a low head on the mast; `updateSignals()` switches the lenses
   from net.signal() every frame. Route-independent materials (`junctionMats` are in the mirror-flip list, world/render.js). */
const SIG = {
  pole: new THREE.MeshBasicMaterial({ color: 0x4d5258 }), housing: new THREE.MeshBasicMaterial({ color: 0x17191b }), plate: new THREE.MeshBasicMaterial({ color: 0x2a2c2e }),
  on: [0xff2a1a, 0xffaa1a, 0x2aff6a].map(c => new THREE.MeshBasicMaterial({ color: c, toneMapped: false })),   // self-lit (night lighting skips toneMapped:false)
  off: [0x3a0f0b, 0x3a2a0b, 0x0b3218].map(c => new THREE.MeshBasicMaterial({ color: c })),
};
const GLOW = [0xff3a22, 0xffa020, 0x40ff80];
export const junctionMats = [SIG.pole, SIG.housing, SIG.plate, ...SIG.on, ...SIG.off];
const STOP_MAT = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide, transparent: true, alphaTest: .4, map: canvasTex(128, 128, (g, w) => {
  const c = w / 2, r = 60; g.beginPath(); for (let i = 0; i < 8; i++) { const a = (i + .5) / 8 * Math.PI * 2; g.lineTo(c + Math.cos(a) * r, c + Math.sin(a) * r); } g.closePath();
  g.fillStyle = '#c8161c'; g.fill(); g.lineWidth = 6; g.strokeStyle = '#f4f4f0'; g.stroke();
  g.fillStyle = '#f4f4f0'; g.font = 'bold 38px sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('STOP', c, c + 2);
}, false) });
const SIGN_GEO = new THREE.PlaneGeometry(1, 1);

export const heads = new Set();   // signal heads of the built chunks: { j, app, lamps: [[r, a, g], …] } (each lamp { m: lens mesh, gl: night glow sprite })
const STATE_IX = { R: 0, A: 1, G: 2 };
export function updateSignals() {
  for (const h of heads) {
    const k = STATE_IX[net.signal(h.j, h.app)] ?? -1;
    for (const ls of h.lamps) for (let i = 0; i < 3; i++) { ls[i].m.material = i === k ? SIG.on[i] : SIG.off[i]; ls[i].gl.visible = i === k; }
  }
}

/* a mast at spine (s, lat) facing traffic with heading h (model: lenses on +z, arm along -x = over the lanes to the driver's left) */
function mast(arm) {
  const g = group(), H = 6.2, lamps = [];
  g.add(mk(GEO.box, SIG.pole, .22, H, .22, 0, H / 2, 0)); g.add(mk(GEO.box, SIG.pole, arm, .14, .14, -arm / 2, H - .15, 0));
  for (const [x, y, sc] of [[-arm, H - 1, 1], [-.32, 3.3, .8]]) {   // overhead head + a low one on the mast
    g.add(mk(GEO.box, SIG.plate, .75 * sc, 1.6 * sc, .04, x, y, -.18)); g.add(mk(GEO.box, SIG.housing, .46 * sc, 1.3 * sc, .3, x, y, 0));
    lamps.push([0, 1, 2].map(i => {
      const m = mk(GEO.box, SIG.off[i], .28 * sc, .28 * sc, .06, x, y + (1 - i) * .4 * sc, .17), gl = glow(GLOW[i], 2.2 * sc, 1, x, y + (1 - i) * .4 * sc, .35);   // the glow only shows at night (glow.js)
      gl.visible = false; g.add(m, gl); return { m, gl };
    }));
  }
  g.userData = { kind: 'pole', size: 1, debris: SIG.pole }; return { g, lamps };
}
function stopSign() {
  const g = group(); g.add(mk(GEO.box, MAT.steel, .08, 2.2, .08, 0, 1.1, 0));
  const p = mesh(SIGN_GEO, STOP_MAT); p.scale.set(.9, .9, 1); p.position.set(0, 2.25, .05); g.add(p);
  g.userData = { kind: 'sign', size: 1, debris: MAT.steel }; return g;
}

/* ctx = { surf, pad, marks (strip meshes), place(obj, s, lat, yaw) (raw spine placement), reg(obj, id, s, lat), destroyed, heads (chunk's list) } */
export function buildJunction(j, ctx) { if (j.kind === 'start') buildStart(j, ctx); else buildCrossing(j, ctx); }

function buildCrossing(j, { surf, pad, marks, place, reg, destroyed, heads: own }) {
  const line = net.lineOf(j), t = roadAt(j.s).t, half = sd => sd > 0 ? j.halfR : j.halfL;
  strip(pad, spineStations(j.s + j.pad.a0, j.s + j.pad.a1, 1), [[j.pad.l0, .13], [j.pad.l1, .87]]);
  for (const sd of j.arms) {
    const cin = sd * (half(sd) + SHOULDER), cout = sd * j.len, st = lineStations(line, Math.min(cin, cout), Math.max(cin, cout));
    strip(surf, st, surfCols(() => j.sl, () => j.sl));
    markLines(marks, st, st.map(() => ({ nR: j.sl, nL: j.sl, centre: j.sl > 1 ? 'double' : null, edge: true })));
    const cs = sd * (half(sd) + 1.4);   // stop line of the traffic coming in on this arm (it drives towards c = 0: dir -sd, on the -sd side)
    bar(marks, lineStations(line, cs - .2, cs + .2), sd > 0 ? -edgeOf(j.sl) : .2, sd > 0 ? -.2 : edgeOf(j.sl));
    if (!j.signal) {   // give way: STOP sign on the right of the incoming side-road traffic
      const id = j.id + ':stop' + sd; if (destroyed.has(id)) continue;
      const g = stopSign(), s = j.s + sd * (edgeOf(j.sl) + 1.6), lat = sd * (half(sd) + 2.5); place(g, s, lat, -(t + Math.PI / 2 + (sd > 0 ? Math.PI : 0))); reg(g, id, s, lat);
    }
  }
  if (!j.signal) return;
  for (const dir of [1, -1]) {
    const sl = j.s - dir * (j.mouth + 1.2); bar(marks, spineStations(sl - .2, sl + .2, 1), dir > 0 ? .2 : -edgeOf(j.nL), dir > 0 ? edgeOf(j.nR) : -.2);
  }
  // masts: main approaches on the far-right corner, cross approaches likewise (only from an existing arm)
  const masts = [
    { app: 'main', s: j.s + j.mouth + 1.5, lat: j.halfR + 1.6, yaw: -t, arm: j.halfR + 1.6 - edgeOf(j.nR) / 2 },
    { app: 'main', s: j.s - j.mouth - 1.5, lat: -(j.halfL + 1.6), yaw: -t + Math.PI, arm: j.halfL + 1.6 - edgeOf(j.nL) / 2 },
    j.arms.includes(-1) && { app: 'cross', s: j.s - j.sideHalf - 1.6, lat: j.halfR + 1.5, yaw: -(t + Math.PI / 2), arm: j.sideHalf + 1.6 - edgeOf(j.sl) / 2 },
    j.arms.includes(1) && { app: 'cross', s: j.s + j.sideHalf + 1.6, lat: -(j.halfL + 1.5), yaw: -(t - Math.PI / 2), arm: j.sideHalf + 1.6 - edgeOf(j.sl) / 2 },
  ].filter(Boolean);
  masts.forEach((m, k) => {
    const id = j.id + ':sig' + k; if (destroyed.has(id)) return;
    const { g, lamps } = mast(m.arm), h = { j, app: m.app, lamps };
    place(g, m.s, m.lat, m.yaw); reg(g, id, m.s, m.lat); own.push(h); heads.add(h);
  });
  updateSignals();
}

function buildStart(j, { surf, pad, marks, place, reg, destroyed }) {
  const x = net.mainXs(net.Sm), m0 = net.Sm - 1500, Sm = net.Sm;
  strip(surf, mainStations(m0, Sm), surfCols(() => x.nL, () => x.nR));   // the main road behind the turn
  const st = mainStations(m0, Sm + j.pad.a0, Sm);
  markLines(marks, st, st.map(() => x), (i, kind, side) => kind === 'edge' && side > 0 && i === 2);   // the near edge line opens at the depot exit
  strip(pad, mainStations(Sm + j.pad.a0, Sm + j.pad.a1), [[j.pad.l0, .13], [j.pad.l1, .87]]);
  bar(marks, spineStations(net.sA - .2, net.sA + .2, 1), .2, 4.3);   // stop line of the depot road
  const id = 'j0:stop'; if (destroyed.has(id)) return;
  const g = stopSign(); place(g, net.sA - 1.5, 5.6); reg(g, id, net.sA - 1.5, 5.6);
}
