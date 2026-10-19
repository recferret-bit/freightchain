import * as THREE from 'three';
import { basic } from './mats.js';

/* Distant scenery around the camera (the group is moved with the camera so it never gets closer). Depth comes from LAYERS: each ring/ridge sits at its own
   distance, so the scene fog hazes the far ones more (colour contrast + silhouettes overlapping), and every layer is ONE merged mesh with baked vertex colours
   (a darker foot, a lighter top, a jagged snow line, per-face jitter) – a handful of draw calls instead of one per peak. The faces carry normals, so the
   daytime form shade (nightlight.js) lights the sun side and darkens the other.
   A layer is either { count, peak } (isolated peaks) or { ridge } (a continuous mountain range, see createRidge).
   peak(i, count) → { r (base radius), h (height), dist (ring radius), color, segs?, lv? (height rings), top? (0..1 → flat-topped mesa), cap? (snow colour), capFrac? (snow share of the height), jitter? }
   ridge → { dist, h, vary? (0..1 how jagged the skyline is), color, cap?, capFrac?, n? (columns), seed? } */
const hash = (a, b) => { const s = Math.sin(a * 127.1 + b * 311.7) * 43758.5453; return s - Math.floor(s); };   // 0..1, deterministic (no Math.random: the scenery must not change between frames or rides)
const smooth = t => t * t * (3 - 2 * t);
/* value noise along a closed loop: `period` lattice points, wraps */
const loopNoise = (x, period, seed) => { const i = Math.floor(x), f = smooth(x - i); return hash(((i % period) + period) % period, seed) * (1 - f) + hash((((i + 1) % period) + period) % period, seed) * f; };
const lin = c => { const f = v => { v /= 255; return v <= .04045 ? v / 12.92 : Math.pow((v + .055) / 1.055, 2.4); }; return [f(c >> 16 & 255), f(c >> 8 & 255), f(c & 255)]; };   // vertex colours are linear (like THREE.Color(hex))

/* collects flat-shaded triangles; the winding is fixed so the face looks along `hint` (outward for a peak, towards the camera for a ridge) */
function builder() {
  const pos = [], nor = [], col = [];
  return {
    tri(a, b, c, rgb, hint) {
      const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2], vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
      let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      if (nx * hint[0] + ny * hint[1] + nz * hint[2] < 0) { [b, c] = [c, b]; nx = -nx; ny = -ny; nz = -nz; }
      const l = Math.hypot(nx, ny, nz) || 1; nx /= l; ny /= l; nz /= l;
      for (const p of [a, b, c]) { pos.push(p[0], p[1], p[2]); nor.push(nx, ny, nz); col.push(rgb[0], rgb[1], rgb[2]); }
    },
    quad(a, b, c, d, rgb, hint) { this.tri(a, b, c, rgb, hint); this.tri(a, c, d, rgb, hint); },
    mesh() {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pos), 3));
      g.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(nor), 3));
      g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(col), 3));
      return new THREE.Mesh(g, basic(0xffffff, { vertexColors: true }));
    },
  };
}
/* the colour of a face: rock darker at the foot, lighter at the top, a snow line with a ragged edge, a little per-face variation */
function faceColor(base, snow, snowAt, t, j) {
  const k = (.74 + .3 * t) * (1 + (j - .5) * .16);
  if (snow && t > snowAt) return snow.map(v => v * (.93 + (j - .5) * .12));
  return base.map(v => Math.min(1, v * k));
}

function addPeak(B, p, i, count) {
  const S = p.segs ?? 6, LV = p.lv ?? 4, base = lin(p.color), snow = p.cap != null ? lin(p.cap) : null, capFrac = p.capFrac ?? .35;
  const a = (i / count) * Math.PI * 2 + (p.jitter ?? Math.sin(i * 7.3) * .1), cx = Math.sin(a) * p.dist, cz = -Math.cos(a) * p.dist;
  const aspect = .62 + .38 * hash(i, 1), rot = i, cr = Math.cos(rot), sr = Math.sin(rot);   // squashed footprint turned at random: a ridge, not a pencil
  const lean = [(hash(i, 2) - .5) * .3 * p.r, (hash(i, 3) - .5) * .3 * p.r];
  const rows = [];
  for (let k = 0; k <= LV; k++) {
    const t = k / LV, rp = p.top ? 1 - t * (1 - p.top) : (k === LV ? 0 : Math.pow(1 - t, .85)), row = [];
    for (let s = 0; s < (rp === 0 ? 1 : S); s++) {
      const ang = (s / S) * Math.PI * 2, rad = p.r * rp * (1 + (k && k < LV ? (hash(i * 13 + k, s) - .5) * .5 : (hash(i * 13, s) - .5) * .2));
      const lx = Math.cos(ang) * rad * aspect + lean[0] * t * t, lz = Math.sin(ang) * rad + lean[1] * t * t;
      row.push([cx + lx * cr - lz * sr, p.h * t * (1 + (k && k < LV ? (hash(i * 7 + k, s + 5) - .5) * .12 : 0)) - 2, cz + lx * sr + lz * cr]);
    }
    rows.push(row);
  }
  const out = v => [v[0] - cx, .35, v[2] - cz];
  for (let k = 0; k < LV; k++) {
    const lo = rows[k], hi = rows[k + 1];
    for (let s = 0; s < S; s++) {
      const s1 = (s + 1) % S, t = (k + .5) / LV, j = hash(i * 31 + k, s), c = faceColor(base, snow, 1 - capFrac + (hash(i, s) - .5) * .14, t, j);
      if (hi.length === 1) B.tri(lo[s], lo[s1], hi[0], c, out(lo[s]));
      else B.quad(lo[s], lo[s1], hi[s1], hi[s], c, out(lo[s]));
    }
  }
  if (p.top) {   // the flat top of a mesa
    const top = rows[LV], c = faceColor(base, snow, 1 - capFrac, 1, .5);
    for (let s = 1; s < S - 1; s++) B.tri(top[0], top[s], top[s + 1], c, [0, 1, 0]);
  }
}

/* a continuous range: three rows of vertices round the whole horizon, the skyline a noisy profile. Each row is a bit further out than the one below,
   so the faces slope up towards the camera and the sun can pick them out. */
export function createRidge({ dist, h, vary = .5, color, cap, capFrac = .3, n = 160, seed = 1 }) {
  const B = builder(), base = lin(color), snow = cap != null ? lin(cap) : null, P1 = Math.max(4, Math.round(n / 7)), P2 = Math.max(8, Math.round(n / 2.5)), P3 = n;
  const H = j => h * (1 - vary + vary * (.55 * loopNoise(j * P1 / n, P1, seed) + .33 * loopNoise(j * P2 / n, P2, seed + 3) + .12 * loopNoise(j, P3, seed + 7)) * 1.4);
  const at = (j, row) => {
    const jj = j % n, a = (jj / n) * Math.PI * 2, hh = H(jj), wob = 1 + (hash(jj, seed + row) - .5) * .05;
    const d = dist * [.93, 1, 1.05][row] * wob, y = [-2, hh * .5 + (hash(jj, seed + 9) - .5) * hh * .12, hh][row];
    return [Math.sin(a) * d, y, -Math.cos(a) * d];
  };
  const lineAt = (hash(1, seed) - .5) * .1 + 1 - capFrac;
  for (let j = 0; j < n; j++) {
    for (let r = 0; r < 2; r++) {
      const a = at(j, r), b = at(j + 1, r), c = at(j + 1, r + 1), d = at(j, r + 1), cx = a[0] + b[0] + c[0] + d[0], cz = a[2] + b[2] + c[2] + d[2];
      const t = (a[1] + b[1] + c[1] + d[1]) / 4 / h, col = faceColor(base, snow, lineAt + (hash(j, seed + 2) - .5) * .12, Math.max(0, t), hash(j, r + seed * 3));
      B.quad(a, b, c, d, col, [-cx, (cx * cx + cz * cz) ** .5 * .5 * (r ? 1 : .2), -cz]);   // faces look back at the camera (and up)
    }
  }
  return B.mesh();
}

/* one ring of isolated peaks, merged into one mesh */
export function createRing({ count, peak }) {
  const B = builder();
  for (let i = 0; i < count; i++) addPeak(B, peak(i, count), i, count);
  return B.mesh();
}
/* several layers (far → near is up to the theme) in one group */
export function createRings(rings) { const g = new THREE.Group(); for (const r of rings) g.add(r.ridge ? createRidge(r.ridge) : createRing(r)); return g; }
