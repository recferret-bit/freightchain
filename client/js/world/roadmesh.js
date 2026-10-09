import * as THREE from 'three';
import { roadAt } from '../road.js';
import { net, edgeOf, SHOULDER } from '../net/network.js';
import { MARK, MARK_COLS } from '../themes/_shared/road-texture.js';
import { ObjectPool } from './pool.js';
import { env } from './environment.js';

/* Road surface + markings as pooled, rewritable meshes. Each 32 m chunk gets (at most) three: `surf` (spine ribbon, side roads, the main road behind
   the start), `pad` (junction aprons, drawn over the road with a polygon offset) and `marks` (all lines, alpha-tested atlas – themes/_shared/road-texture.js).
   Widths follow the network's cross-section (net.xs), so lanes can be added/dropped and roads can cross. Vertex data is rewritten in place on reuse. */
const CAP = 2400;   // vertices per mesh (a chunk with a crossroads and two 2+2 side roads ≈ 400)
export const stripPool = new ObjectPool('strip', () => {
  const pos = new Float32Array(CAP * 3), uv = new Float32Array(CAP * 2), idx = new Uint16Array(CAP * 3), geo = new THREE.BufferGeometry();
  const pa = new THREE.BufferAttribute(pos, 3), ua = new THREE.BufferAttribute(uv, 2), ia = new THREE.BufferAttribute(idx, 1);
  geo.setAttribute('position', pa); geo.setAttribute('uv', ua); geo.setIndex(ia);
  const m = new THREE.Mesh(geo, null); m.frustumCulled = false; m.userData = { strip: { pos, uv, idx, pa, ua, ia, nv: 0, ni: 0, y: 0 } }; return m;
}, m => { m.material = null; m.userData.strip.nv = m.userData.strip.ni = 0; });

export function strips(y) { const m = stripPool.acquire(), d = m.userData.strip; d.nv = d.ni = 0; d.y = y; return m; }
export function finish(m, mat) {
  const d = m.userData.strip; d.pa.needsUpdate = d.ua.needsUpdate = d.ia.needsUpdate = true; m.geometry.setDrawRange(0, d.ni); m.material = mat; return d.ni > 0;
}
/* a strip along stations st[i] = { x, z, rx, rz, v } (rx/rz = unit right vector) across columns cols[k] = [lat | i => lat, u] (lat increasing = faces up) */
export function strip(m, st, cols) {
  const d = m.userData.strip, nc = cols.length; if (st.length < 2 || d.nv + st.length * nc > CAP || d.ni + (st.length - 1) * (nc - 1) * 6 > CAP * 3) return;
  const base = d.nv;
  for (let i = 0; i < st.length; i++) for (const [lat, u] of cols) {
    const l = typeof lat === 'function' ? lat(i) : lat, p = st[i], k = d.nv++;
    d.pos[k * 3] = p.x + p.rx * l; d.pos[k * 3 + 1] = d.y; d.pos[k * 3 + 2] = p.z + p.rz * l; d.uv[k * 2] = u; d.uv[k * 2 + 1] = p.v;
  }
  for (let i = 0; i + 1 < st.length; i++) for (let k = 0; k + 1 < nc; k++) { const a = base + i * nc + k, c = a + nc; const I = d.idx, n = d.ni; I[n] = a; I[n + 1] = a + 1; I[n + 2] = c; I[n + 3] = a + 1; I[n + 4] = c + 1; I[n + 5] = c; d.ni += 6; }   // (no per-quad array)
}
const station = (p, v, s) => ({ x: p.x, z: p.z, rx: Math.cos(p.t), rz: Math.sin(p.t), v, s });
export const spineStations = (s0, s1, n) => Array.from({ length: n + 1 }, (_, i) => { const s = s0 + (s1 - s0) * i / n; return station(roadAt(s), s / 9, s); });
export const mainStations = (...ms) => ms.map(m => station(net.mainAt(m), m / 9, m));   // the main road (straight behind the start turn)
export const lineStations = (line, c0, c1) => [c0, c1].map(c => station(line.at(c), c / 9, c));
const ucol = c => (c + .5) / MARK_COLS;
/* a painted line: a 2-column strip of width w around lat(i) */
export const line = (m, st, lat, w, col) => strip(m, st, [[i => lat(i) - w / 2, ucol(col)], [i => lat(i) + w / 2, ucol(col)]]);
/* across-the-road bar (stop line): `st` = 2 stations a few dm apart, from lat a to b */
export const bar = (m, st, a, b) => strip(m, st, [[a, ucol(MARK.stop)], [b, ucol(MARK.stop)]]);
/* surface columns for nL / nR lanes (fractional allowed) */
export const surfCols = (nL, nR) => [[i => -edgeOf(nL(i)) - .3 - SHOULDER, 0], [i => -edgeOf(nL(i)) - .3, .125], [i => edgeOf(nR(i)) + .3, .875], [i => edgeOf(nR(i)) + .3 + SHOULDER, 1]];

/* runs of stations where `has(i)` holds, as sub-arrays (a line needs at least two stations) */
function runs(st, has) {
  const out = []; let cur = null;
  for (let i = 0; i < st.length; i++) { if (has(i)) (cur ??= []).push(i); else if (cur) { out.push(cur); cur = null; } }
  if (cur) out.push(cur); return out.filter(r => r.length > 1);
}
/* centre / edge / lane lines for stations along a road whose cross-section is xs[i] = { nR, nL, centre, edge }. skip(i, kind, side) = leave out (junction boxes). */
export function markLines(m, st, xs, skip = () => false) {
  const M = env.roadMat, put = (has, lat, w, col) => { for (const r of runs(st, has)) line(m, r.map(i => st[i]), k => lat(r[k]), w, col); };
  const style = i => { const c = xs[i].centre; return c === 'none' ? null : c ?? M.centre; };
  for (const [st0, col, off] of [['dash', MARK.dash, [0]], ['solid', MARK.solid, [0]], ['double', MARK.solid, [-.18, .18]]]) for (const o of off) put(i => style(i) === st0 && !skip(i, 'centre', 0), () => o, .15, col);
  if (M.edge) for (const side of [-1, 1]) put(i => xs[i].edge && !skip(i, 'edge', side), i => side * edgeOf(side > 0 ? xs[i].nR : xs[i].nL), .16, MARK.edge);
  for (const side of [-1, 1]) for (let k = 1; k <= 2; k++) put(i => xs[i].edge !== false && (side > 0 ? xs[i].nR : xs[i].nL) >= k + 1 - 1e-3 && !skip(i, 'lane', side), () => side * edgeOf(k), .13, MARK.lane);
}

/* the spine's ribbon + markings for [s0, s1) */
export function buildSpine(surf, marks, s0, s1) {
  const st = spineStations(s0, s1, 16), xs = st.map(p => net.xs(p.s)), js = net.near(s0 - 60, s1 + 60).filter(j => !(net.straight && j.kind === 'start'));   // a straight start: no gap in the edge line
  strip(surf, st, surfCols(i => xs[i].nL, i => xs[i].nR));
  markLines(marks, st, xs, (i, kind, side) => js.some(j => {
    const a = st[i].s - j.s; if (a < j.pad.a0 || a > j.pad.a1) return false;
    return j.kind === 'cross' || (j.kind === 'tee' ? kind === 'edge' && side === j.side : kind === 'edge' && side > 0);   // crossroads: no lines in the box; T / start: the edge line opens for the side road
  }));
}
