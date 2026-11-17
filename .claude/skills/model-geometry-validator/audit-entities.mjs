#!/usr/bin/env node
// Numeric 3D shape-surface geometry, connectivity, anti-cube complexity & multi-route CIE Lab validator for Freight Chain entities.
// Adapted from TerraAgent's model-geometry-validator for cars, trucks, buses, highway furniture, props, gantries & landmarks.
//   node .claude/skills/model-geometry-validator/audit-entities.mjs --all [--strict] [--quiet] [--json] [--geometry-only]
//   node .claude/skills/model-geometry-validator/audit-entities.mjs sedan freighter motel-strip
//   node .claude/skills/model-geometry-validator/audit-entities.mjs --category vehicle
//   node .claude/skills/model-geometry-validator/audit-entities.mjs --self-test

import { fileURLToPath } from 'node:url';
import { compileEntity, toParts } from '../../../frontend/client/shared/entity/plan.js';
import { boxes } from '../../../frontend/client/shared/entity/measure.js';
import { validateEntity } from '../../../frontend/client/shared/entity/schema.js';
import { rosterOf } from '../../../frontend/client/shared/entity/roster.js';
import { VEHICLES } from '../../../frontend/client/shared/traffic.js';
import SEED from '../../../frontend/client/shared/entity/seed/index.js';

const BASE_LANDMARK_PAL = {
  wall: 0xe8d9b8, roof: 0x7a4a38, trim: 0xf2efe6, glass: 0x5f8fa8, door: 0x7a3b2a,
  lot: 0x3b3b3e, apron: 0x3b3b3e, metal: 0x8a8f96, dark: 0x23252a, accent: 0xc8281f,
  accent2: 0x1f4a9a, neon: 0xffd84a, leaf: 0x3f7a3b, trunk: 0x6b4f33, cone: 0xff7a1a,
  white: 0xf2f2ea, red: 0xd22a22, blue: 0x1f4a9a,
};
// Exact 5-route landmark palettes from frontend/client/js/themes/*/index.js (kept self-contained for MCP container isolation).
const ROUTE_LANDMARK_PALS = [
  { route: 'route66', walls: [0xe8d9b8, 0xd9b99a, 0xb9d4cf], roof: 0x8a4b38 },
  { route: 'stuart', walls: [0xc9c4b5, 0xa8553b, 0xd6cfa8], roof: 0x7a8087, accent: 0xb8321f, leaf: 0x6a7a3a },
  { route: 'siberia', walls: [0xc9c2b0, 0x8c9aa3, 0xa45a3e], roof: 0xe8eef3, trim: 0xe6e9ec, lot: 0x6e7276, apron: 0x6e7276, accent: 0xb5121b, accent2: 0x1f4a9a, leaf: 0x24432e },
  { route: 'brenner', walls: [0xefe6d2, 0xd8c8a8, 0xc7d3dc], roof: 0x7a3a2a, accent: 0x2f6b3a, accent2: 0x8a1f1f, leaf: 0x2f5a33 },
  { route: 'panamerican', walls: [0xd8b896, 0xc46b45, 0xe4dccc], roof: 0xa3482e, lot: 0x4a4640, apron: 0x4a4640, accent: 0xc8281f, accent2: 0x2b6cb0, leaf: 0x6a7a3a },
];
const DEFAULT_PROP_PAL = {
  m: 0x4c7a3b, m1: 0x8a6c54, m2: 0x6f5a4a, trunk: 0x5a4630, leaf: 0x3f7a3b,
  snow: 0xf2f6f8, mark: 0x222222, body: 0xf2f2ea, cap: 0xd22a22, mast: 0x6a6f74,
  bulb: 0xffa84a, rail: 0xadb3ba, post: 0x6a6f74,
};
const GLOBAL_HEX = { red: 0xd22a22, steel: 0x8a8f96, dust: 0xcdb48a };

const MIN_MESHES = { vehicle: 24, landmark: 14, gantry: 12, furniture: 4, prop: 3, part: 1 };
const GROUNDED_PARTS = new Set(['cruiser', 'lm-cones']);
const CONTACT_TOL = 0.005;   // 5 mm true 3D surface contact tolerance (matches TerraAgent 4-5 mm bar)
const NEAR_MISS = 0.08;      // <= 8 cm = hairline gap, > 8 cm = floating part

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

function rotMatrix([x, y, z], order = 'XYZ') {
  const a = Math.cos(x), b = Math.sin(x), c = Math.cos(y), d = Math.sin(y), e = Math.cos(z), f = Math.sin(z);
  const X = [1, 0, 0, 0, a, -b, 0, b, a], Y = [c, 0, d, 0, 1, 0, -d, 0, c], Z = [e, -f, 0, f, e, 0, 0, 0, 1];
  const M = { X, Y, Z }, mul = (p, q) => {
    const r = new Array(9);
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) r[i * 3 + j] = p[i * 3] * q[j] + p[i * 3 + 1] * q[3 + j] + p[i * 3 + 2] * q[6 + j];
    return r;
  };
  return mul(mul(M[order[0]], M[order[1]]), M[order[2]]);
}
const mulMat = (p, q) => {
  const r = new Array(9);
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) r[i * 3 + j] = p[i * 3] * q[j] + p[i * 3 + 1] * q[3 + j] + p[i * 3 + 2] * q[6 + j];
  return r;
};
const applyR = (m, [x, y, z]) => [m[0] * x + m[1] * y + m[2] * z, m[3] * x + m[4] * y + m[5] * z, m[6] * x + m[7] * y + m[8] * z];
const applyRT = (m, [x, y, z]) => [m[0] * x + m[3] * y + m[6] * z, m[1] * x + m[4] * y + m[7] * z, m[2] * x + m[5] * y + m[8] * z];
const IDENT_R = [1, 0, 0, 0, 1, 0, 0, 0, 1];

function closestSeg2D(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy;
  const t = l2 > 1e-12 ? clamp(((px - ax) * dx + (py - ay) * dy) / l2, 0, 1) : 0;
  return [ax + dx * t, ay + dy * t];
}

function closestTri2D(px, py, ax, ay, bx, by, cx, cy) {
  const orient = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
  const s = orient >= 0 ? 1 : -1;
  const e1 = ((bx - ax) * (py - ay) - (by - ay) * (px - ax)) * s;
  const e2 = ((cx - bx) * (py - by) - (cy - by) * (px - bx)) * s;
  const e3 = ((ax - cx) * (py - cy) - (ay - cy) * (px - cx)) * s;
  if (e1 >= -1e-9 && e2 >= -1e-9 && e3 >= -1e-9) return [px, py];
  const c1 = closestSeg2D(px, py, ax, ay, bx, by);
  const c2 = closestSeg2D(px, py, bx, by, cx, cy);
  const c3 = closestSeg2D(px, py, cx, cy, ax, ay);
  let best = c1, bd = (c1[0] - px) ** 2 + (c1[1] - py) ** 2;
  for (const c of [c2, c3]) {
    const d = (c[0] - px) ** 2 + (c[1] - py) ** 2;
    if (d < bd) { bd = d; best = c; }
  }
  return best;
}

function closestEllipseRim2D(px, pz, rx, rz) {
  const ux = Math.abs(px), uz = Math.abs(pz);
  if (ux < 1e-9 && uz < 1e-9) return [rx, 0];
  if (Math.abs(rx - rz) < 1e-7) {
    const d = Math.hypot(px, pz);
    return [(px * rx) / d, (pz * rz) / d];
  }
  let lo = 0, hi = Math.PI / 2;
  for (let i = 0; i < 18; i++) {
    const mid = 0.5 * (lo + hi), ct = Math.cos(mid), st = Math.sin(mid);
    const g = (rx * rx - rz * rz) * ct * st - ux * rx * st + uz * rz * ct;
    if (g > 0) lo = mid; else hi = mid;
  }
  const t = 0.5 * (lo + hi);
  return [(px < 0 ? -1 : 1) * rx * Math.cos(t), (pz < 0 ? -1 : 1) * rz * Math.sin(t)];
}

function closestEllipse2D(px, pz, rx, rz, negZOnly = false) {
  if (negZOnly && pz > 0) return [clamp(px, -rx, rx), 0];
  if ((px / rx) ** 2 + (pz / rz) ** 2 <= 1) return [px, pz];
  const rim = closestEllipseRim2D(px, pz, rx, rz);
  return negZOnly && rim[1] > 0 ? [clamp(px, -rx, rx), 0] : rim;
}

const TAN_PI_8 = Math.tan(Math.PI / 8);
const PHI = (1 + Math.sqrt(5)) / 2;
const DODEC_INRADIUS = (PHI + 1) / (Math.sqrt(3) * Math.hypot(1, PHI));
const DODEC_FACES = (() => {
  const s3 = 1 / Math.sqrt(3), ip = 1 / PHI, nl = 1 / Math.hypot(1, PHI);
  const verts = [];
  for (const x of [-1, 1]) for (const y of [-1, 1]) for (const z of [-1, 1]) verts.push([x * s3, y * s3, z * s3]);
  for (const a of [-1, 1]) for (const b of [-1, 1]) {
    verts.push([0, a * ip * s3, b * PHI * s3], [a * ip * s3, b * PHI * s3, 0], [a * PHI * s3, 0, b * ip * s3]);
  }
  const rawNormals = [];
  for (const a of [-1, 1]) for (const b of [-1, 1]) {
    rawNormals.push([a, 0, b * PHI], [0, a * PHI, b], [a * PHI, b, 0]);
  }
  return rawNormals.map(([nx, ny, nz]) => {
    const n = [nx * nl, ny * nl, nz * nl];
    const fv = verts.filter(v => n[0] * v[0] + n[1] * v[1] + n[2] * v[2] >= DODEC_INRADIUS - 1e-5);
    const ref = Math.abs(n[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
    const ux = ref[1] * n[2] - ref[2] * n[1], uy = ref[2] * n[0] - ref[0] * n[2], uz = ref[0] * n[1] - ref[1] * n[0];
    const ul = Math.hypot(ux, uy, uz) || 1, u = [ux / ul, uy / ul, uz / ul];
    const w = [n[1] * u[2] - n[2] * u[1], n[2] * u[0] - n[0] * u[2], n[0] * u[1] - n[1] * u[0]];
    fv.sort((a, b) => Math.atan2(a[0] * w[0] + a[1] * w[1] + a[2] * w[2], a[0] * u[0] + a[1] * u[1] + a[2] * u[2]) -
      Math.atan2(b[0] * w[0] + b[1] * w[1] + b[2] * w[2], b[0] * u[0] + b[1] * u[1] + b[2] * u[2]));
    return { n, verts: fv };
  });
})();
function closestOct2D(px, pz, hx, hz) {
  const ux = Math.abs(px), uz = Math.abs(pz);
  const kx = hx * TAN_PI_8, kz = hz * TAN_PI_8;
  // Chamfer edge from (hx, kz) to (kx, hz): outward normal ((hz - kz), (hx - kx))
  const nX = hz - kz, nZ = hx - kx;
  if (ux <= hx && uz <= hz && (ux - hx) * nX + (uz - kz) * nZ <= 1e-9) return [px, pz];
  const s1 = closestSeg2D(ux, uz, hx, 0, hx, kz);
  const s2 = closestSeg2D(ux, uz, hx, kz, kx, hz);
  const s3 = closestSeg2D(ux, uz, kx, hz, 0, hz);
  let best = s1, bd = (s1[0] - ux) ** 2 + (s1[1] - uz) ** 2;
  for (const c of [s2, s3]) {
    const d = (c[0] - ux) ** 2 + (c[1] - uz) ** 2;
    if (d < bd) { bd = d; best = c; }
  }
  return [(px < 0 ? -1 : 1) * best[0], (pz < 0 ? -1 : 1) * best[1]];
}

function closestSeg3D(p, a, b) {
  const dx = b[0] - a[0], dy = b[1] - a[1], dz = b[2] - a[2], l2 = dx * dx + dy * dy + dz * dz;
  const t = l2 > 1e-12 ? clamp(((p[0] - a[0]) * dx + (p[1] - a[1]) * dy + (p[2] - a[2]) * dz) / l2, 0, 1) : 0;
  return [a[0] + dx * t, a[1] + dy * t, a[2] + dz * t];
}

function closestTri3D(p, a, b, c) {
  const ab = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const ac = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
  const ap = [p[0] - a[0], p[1] - a[1], p[2] - a[2]];
  const d1 = ab[0] * ap[0] + ab[1] * ap[1] + ab[2] * ap[2];
  const d2 = ac[0] * ap[0] + ac[1] * ap[1] + ac[2] * ap[2];
  if (d1 <= 0 && d2 <= 0) return a;
  const bp = [p[0] - b[0], p[1] - b[1], p[2] - b[2]];
  const d3 = ab[0] * bp[0] + ab[1] * bp[1] + ab[2] * bp[2];
  const d4 = ac[0] * bp[0] + ac[1] * bp[1] + ac[2] * bp[2];
  if (d3 >= 0 && d4 <= d3) return b;
  const vc = d1 * d4 - d3 * d2;
  if (vc <= 0 && d1 >= 0 && d3 <= 0) { const v = d1 / (d1 - d3); return [a[0] + v * ab[0], a[1] + v * ab[1], a[2] + v * ab[2]]; }
  const cp = [p[0] - c[0], p[1] - c[1], p[2] - c[2]];
  const d5 = ab[0] * cp[0] + ab[1] * cp[1] + ab[2] * cp[2];
  const d6 = ac[0] * cp[0] + ac[1] * cp[1] + ac[2] * cp[2];
  if (d6 >= 0 && d5 <= d6) return c;
  const vb = d5 * d2 - d1 * d6;
  if (vb <= 0 && d2 >= 0 && d6 <= 0) { const w = d2 / (d2 - d6); return [a[0] + w * ac[0], a[1] + w * ac[1], a[2] + w * ac[2]]; }
  const va = d3 * d6 - d5 * d4;
  if (va <= 0 && (d4 - d3) >= 0 && (d5 - d6) >= 0) { const w = (d4 - d3) / ((d4 - d3) + (d5 - d6)); return [b[0] + w * (c[0] - b[0]), b[1] + w * (c[1] - b[1]), b[2] + w * (c[2] - b[2])]; }
  const denom = 1 / (va + vb + vc);
  const v = vb * denom, w = vc * denom;
  return [a[0] + ab[0] * v + ac[0] * w, a[1] + ab[1] * v + ac[1] * w, a[2] + ab[2] * v + ac[2] * w];
}

// Exact Euclidean projection onto scaled-local convex primitive (u is in metres before rigid mesh/group rotation+translation).
function projectScaledLocal(geo, [sx, sy, sz], [X, Y, Z]) {
  const hx = sx * 0.5, hy = sy * 0.5, hz = sz * 0.5;
  switch (geo) {
    case 'box':
      return [clamp(X, -hx, hx), clamp(Y, -hy, hy), clamp(Z, -hz, hz)];
    case 'rbox': {
      const rx = sx * 0.085, ry = sy * 0.085, rz = sz * 0.085;
      const cx = clamp(X, -(hx - rx), hx - rx), cy = clamp(Y, -(hy - ry), hy - ry), cz = clamp(Z, -(hz - rz), hz - rz);
      const dx = (X - cx) / (rx || 1e-9), dy = (Y - cy) / (ry || 1e-9), dz = (Z - cz) / (rz || 1e-9);
      const l = Math.hypot(dx, dy, dz);
      if (l <= 1) return [X, Y, Z];
      return [cx + (dx / l) * rx, cy + (dy / l) * ry, cz + (dz / l) * rz];
    }
    case 'wedge': {
      const [qy, qz] = closestTri2D(Y, Z, -hy, -hz, -hy, hz, hy, hz);
      return [clamp(X, -hx, hx), qy, qz];
    }
    case 'gable': {
      const [qx, qy] = closestTri2D(X, Y, -hx, -hy, hx, -hy, 0, hy);
      return [qx, qy, clamp(Z, -hz, hz)];
    }
    case 'oct': {
      const [qx, qz] = closestOct2D(X, Z, hx, hz);
      return [qx, clamp(Y, -hy, hy), qz];
    }
    case 'cyl':
    case 'cyl16':
    case 'wheel20':
    case 'wheel48': {
      const [qx, qz] = closestEllipse2D(X, Z, sx, sz, false);
      return [qx, clamp(Y, -hy, hy), qz];
    }
    case 'barrel': {
      const [qx, qz] = closestEllipse2D(X, Z, sx, sz, true);
      return [qx, clamp(Y, -hy, hy), qz];
    }
    case 'cone': {
      if (Y >= -hy && Y <= hy) {
        const u = (hy - Y) / (2 * hy);
        const rx = sx * u, rz = sz * u;
        if (rx > 1e-7 && rz > 1e-7 && (X / rx) ** 2 + (Z / rz) ** 2 <= 1) return [X, Y, Z];
      }
      const [bx, bz] = closestEllipse2D(X, Z, sx, sz, false);
      const basePt = [bx, -hy, bz];
      const [rimX, rimZ] = closestEllipseRim2D(X, Z, sx, sz);
      const sidePt = closestSeg3D([X, Y, Z], [0, hy, 0], [rimX, -hy, rimZ]);
      const db = (basePt[0] - X) ** 2 + (basePt[1] - Y) ** 2 + (basePt[2] - Z) ** 2;
      const ds = (sidePt[0] - X) ** 2 + (sidePt[1] - Y) ** 2 + (sidePt[2] - Z) ** 2;
      return db <= ds ? basePt : sidePt;
    }
    case 'pyr': {
      if (Y >= -hy && Y <= hy) {
        const u = (hy - Y) / (2 * hy);
        if (Math.abs(X) <= hx * u + 1e-9 && Math.abs(Z) <= hz * u + 1e-9) return [X, Y, Z];
      }
      const cands = [
        [clamp(X, -hx, hx), -hy, clamp(Z, -hz, hz)],
        closestTri3D([X, Y, Z], [0, hy, 0], [-hx, -hy, hz], [hx, -hy, hz]),
        closestTri3D([X, Y, Z], [0, hy, 0], [hx, -hy, -hz], [-hx, -hy, -hz]),
        closestTri3D([X, Y, Z], [0, hy, 0], [hx, -hy, hz], [hx, -hy, -hz]),
        closestTri3D([X, Y, Z], [0, hy, 0], [-hx, -hy, -hz], [-hx, -hy, hz]),
      ];
      let best = cands[0], bd = Infinity;
      for (const c of cands) {
        const d = (c[0] - X) ** 2 + (c[1] - Y) ** 2 + (c[2] - Z) ** 2;
        if (d < bd) { bd = d; best = c; }
      }
      return best;
    }
    case 'rock':
    default: {
      // Exact 12-pentagon DodecahedronGeometry(1, 0) projection (inradius = 0.7947, max |axis| = 0.9342).
      const invX = 1 / (sx || 1e-9), invY = 1 / (sy || 1e-9), invZ = 1 / (sz || 1e-9);
      const ux = X * invX, uy = Y * invY, uz = Z * invZ;
      let inside = true;
      for (let i = 0; i < DODEC_FACES.length; i++) {
        const fn = DODEC_FACES[i].n;
        if (fn[0] * ux + fn[1] * uy + fn[2] * uz > DODEC_INRADIUS + 1e-9) { inside = false; break; }
      }
      if (inside) return [X, Y, Z];
      let best = null, bd = Infinity;
      for (let i = 0; i < DODEC_FACES.length; i++) {
        const { n: fn, verts: fv } = DODEC_FACES[i];
        if (fn[0] * ux + fn[1] * uy + fn[2] * uz < DODEC_INRADIUS - 1e-5 && best) continue;
        const v0 = [fv[0][0] * sx, fv[0][1] * sy, fv[0][2] * sz];
        for (let k = 1; k < 4; k++) {
          const v1 = [fv[k][0] * sx, fv[k][1] * sy, fv[k][2] * sz];
          const v2 = [fv[k + 1][0] * sx, fv[k + 1][1] * sy, fv[k + 1][2] * sz];
          const c = closestTri3D([X, Y, Z], v0, v1, v2);
          const d = (c[0] - X) ** 2 + (c[1] - Y) ** 2 + (c[2] - Z) ** 2;
          if (d < bd) { bd = d; best = c; }
        }
      }
      return best ?? [X, Y, Z];
    }
  }
}

function buildShapeNodes(parts) {
  const bs = boxes(parts);
  const xforms = parts.map(() => ({ R: IDENT_R, T: [0, 0, 0] }));
  parts.forEach((p, idx) => {
    const par = p.parent < 0 ? { R: IDENT_R, T: [0, 0, 0] } : xforms[p.parent];
    if (p.t === 'group' || p.t === 'mesh') {
      const localR = p.r ? rotMatrix(p.r, p.order ?? 'XYZ') : IDENT_R;
      const R = mulMat(par.R, localR);
      const off = applyR(par.R, p.p);
      xforms[idx] = { R, T: [par.T[0] + off[0], par.T[1] + off[1], par.T[2] + off[2]] };
    }
  });
  return bs.map(b => {
    const { R, T } = xforms[b.i];
    const project = w => {
      const loc = applyRT(R, [w[0] - T[0], w[1] - T[1], w[2] - T[2]]);
      const cl = projectScaledLocal(b.part.geo, b.part.s, loc);
      const rw = applyR(R, cl);
      return [rw[0] + T[0], rw[1] + T[1], rw[2] + T[2]];
    };
    const lowPt = project([T[0], T[1] - 200, T[2]]);
    return { ...b, R, center: T, project, trueMinY: lowPt[1] };
  });
}

function boxDist(a, b) {
  const dx = Math.max(0, a[0] - b[3], b[0] - a[3]);
  const dy = Math.max(0, a[1] - b[4], b[1] - a[4]);
  const dz = Math.max(0, a[2] - b[5], b[2] - a[5]);
  return Math.hypot(dx, dy, dz);
}

// Exact minimum distance between two 3D convex mesh primitives via multi-seed alternating projections.
function shapeDist(A, B, cutoff = Infinity) {
  const lb = boxDist(A.box, B.box);
  if (lb > cutoff) return lb;
  const seeds = [
    [0.5 * (Math.max(A.box[0], B.box[0]) + Math.min(A.box[3], B.box[3])), 0.5 * (Math.max(A.box[1], B.box[1]) + Math.min(A.box[4], B.box[4])), 0.5 * (Math.max(A.box[2], B.box[2]) + Math.min(A.box[5], B.box[5]))],
    A.center,
    B.center,
    [B.center[0], A.box[4], B.center[2]],
    [A.center[0], B.box[1], A.center[2]],
  ];
  let best = Infinity;
  for (const seed of seeds) {
    let b = B.project(seed), a = A.project(b);
    for (let k = 0; k < 26; k++) {
      b = B.project(a);
      a = A.project(b);
      const d = Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
      if (d < best) best = d;
      if (best <= 1e-4) return 0;
    }
  }
  return best;
}

function hexToLab(hex) {
  const ch = v => { const s = v / 255; return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; };
  const r = ch((hex >> 16) & 255), g = ch((hex >> 8) & 255), b = ch(hex & 255);
  const x = (r * 0.4124 + g * 0.3576 + b * 0.1805) / 0.95047;
  const y = (r * 0.2126 + g * 0.7152 + b * 0.0722);
  const z = (r * 0.0193 + g * 0.1192 + b * 0.9505) / 1.08883;
  const f = t => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  const fx = f(x), fy = f(y), fz = f(z);
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

export function deltaE76(hexA, hexB) {
  const a = hexToLab(hexA), b = hexToLab(hexB);
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

function resolveHex(mat, kind, pal = BASE_LANDMARK_PAL) {
  const m = Array.isArray(mat) ? mat[0] : mat;
  if (!m) return 0x808080;
  if (typeof m.color === 'number') return m.color;
  if (m.global) return GLOBAL_HEX[m.global] ?? 0x8a8f96;
  if (m.sign) return m.sign === 'red' ? pal.accent : m.sign === 'blue' ? pal.accent2 : m.sign === 'cream' ? pal.trim : pal.neon;
  if (m.disk) return m.disk === 'blue' ? pal.accent2 : m.disk === 'cream' ? pal.trim : pal.accent;
  if (m.edge) return pal.dark ?? 0x23252a;
  if (m.facade) return 0x7a9bb0;
  if (m.flag !== undefined) return 0xd22a22;
  if (m.slot) return (kind === 'landmark' || kind === 'part' ? pal[m.slot] : null) ?? DEFAULT_PROP_PAL[m.slot] ?? pal[m.slot] ?? 0x808080;
  return 0x808080;
}

function matKey(mat, kind, pal = BASE_LANDMARK_PAL) {
  const m = Array.isArray(mat) ? mat[0] : mat;
  if (!m) return 'none';
  if (m.facade) return `facade:${m.facade.join('x')}`;
  if (m.sign) return `sign:${m.sign}:${m.text ?? ''}`;
  if (m.disk) return `disk:${m.disk}:${m.text ?? ''}`;
  if (m.flag !== undefined) return `flag:${m.flag}`;
  if (m.slot && !(m.slot in pal) && !(m.slot in DEFAULT_PROP_PAL)) return `slot:${m.slot}`;
  return `hex:${resolveHex(m, kind, pal).toString(16).padStart(6, '0')}:${m.lamp ? 1 : 0}`;
}

function boxArea(b) {
  const dx = Math.max(0, b[3] - b[0]), dy = Math.max(0, b[4] - b[1]), dz = Math.max(0, b[5] - b[2]);
  return 2 * (dx * dy + dy * dz + dx * dz);
}

function overlap1D(a0, a1, b0, b1) {
  return Math.max(0, Math.min(a1, b1) - Math.max(a0, b0));
}

function insideFraction(inner, outer) {
  const dx = inner[3] - inner[0], dy = inner[4] - inner[1], dz = inner[5] - inner[2];
  const vol = dx * dy * dz;
  if (vol <= 1e-6) return 0;
  const ox = overlap1D(inner[0], inner[3], outer[0], outer[3]);
  const oy = overlap1D(inner[1], inner[4], outer[1], outer[4]);
  const oz = overlap1D(inner[2], inner[5], outer[2], outer[5]);
  return (ox * oy * oz) / vol;
}

// Extract world-space oriented planar polygons for rotated/sloped z-fighting & surface-detail audits.
function planarFacesOf(node) {
  const { geo, s: [sx, sy, sz], mat } = node.part;
  const { R, center: T } = node;
  const hx = sx * 0.5, hy = sy * 0.5, hz = sz * 0.5;
  const faces = [];
  const faceMatAt = gi => (Array.isArray(mat) ? (mat[gi] ?? mat[0]) : mat);
  const add = (localVerts, hint, gi = 0) => {
    const wv = localVerts.map(v => { const r = applyR(R, v); return [r[0] + T[0], r[1] + T[1], r[2] + T[2]]; });
    const e1 = [wv[1][0] - wv[0][0], wv[1][1] - wv[0][1], wv[1][2] - wv[0][2]];
    const e2 = [wv[2][0] - wv[0][0], wv[2][1] - wv[0][1], wv[2][2] - wv[0][2]];
    let nx = e1[1] * e2[2] - e1[2] * e2[1], ny = e1[2] * e2[0] - e1[0] * e2[2], nz = e1[0] * e2[1] - e1[1] * e2[0];
    const l = Math.hypot(nx, ny, nz);
    if (l < 1e-9) return;
    nx /= l; ny /= l; nz /= l;
    const wh = applyR(R, hint);
    if (nx * wh[0] + ny * wh[1] + nz * wh[2] < 0) { nx = -nx; ny = -ny; nz = -nz; wv.reverse(); }
    const normal = [nx, ny, nz], offset = nx * wv[0][0] + ny * wv[0][1] + nz * wv[0][2];
    let area = 0;
    for (let k = 1; k + 1 < wv.length; k++) {
      const a = [wv[k][0] - wv[0][0], wv[k][1] - wv[0][1], wv[k][2] - wv[0][2]];
      const b = [wv[k + 1][0] - wv[0][0], wv[k + 1][1] - wv[0][1], wv[k + 1][2] - wv[0][2]];
      area += 0.5 * Math.hypot(a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]);
    }
    faces.push({ normal, offset, poly: wv, area, localHint: hint, mat: faceMatAt(gi) });
  };
  if (geo === 'box' || geo === 'rbox') {
    const k = geo === 'rbox' ? 0.83 : 1, vx = hx * k, vy = hy * k, vz = hz * k;
    add([[hx, -vy, vz], [hx, -vy, -vz], [hx, vy, -vz], [hx, vy, vz]], [1, 0, 0], 0);
    add([[-hx, -vy, -vz], [-hx, -vy, vz], [-hx, vy, vz], [-hx, vy, -vz]], [-1, 0, 0], 1);
    add([[-vx, hy, vz], [vx, hy, vz], [vx, hy, -vz], [-vx, hy, -vz]], [0, 1, 0], 2);
    add([[-vx, -hy, -vz], [vx, -hy, -vz], [vx, -hy, vz], [-vx, -hy, vz]], [0, -1, 0], 3);
    add([[-vx, -vy, hz], [vx, -vy, hz], [vx, vy, hz], [-vx, vy, hz]], [0, 0, 1], 4);
    add([[vx, -vy, -hz], [-vx, -vy, -hz], [-vx, vy, -hz], [vx, vy, -hz]], [0, 0, -1], 5);
  } else if (geo === 'wedge') {
    add([[-hx, -hy, -hz], [hx, -hy, -hz], [hx, hy, hz], [-hx, hy, hz]], [0, 1, -1]);
    add([[-hx, -hy, hz], [hx, -hy, hz], [hx, hy, hz], [-hx, hy, hz]], [0, 0, 1]);
    add([[-hx, -hy, hz], [hx, -hy, hz], [hx, -hy, -hz], [-hx, -hy, -hz]], [0, -1, 0]);
    add([[-hx, -hy, -hz], [-hx, hy, hz], [-hx, -hy, hz]], [-1, 0, 0]);
    add([[hx, -hy, -hz], [hx, -hy, hz], [hx, hy, hz]], [1, 0, 0]);
  } else if (geo === 'gable') {
    add([[-hx, -hy, -hz], [-hx, -hy, hz], [0, hy, hz], [0, hy, -hz]], [-1, 1, 0]);
    add([[hx, -hy, hz], [hx, -hy, -hz], [0, hy, -hz], [0, hy, hz]], [1, 1, 0]);
    add([[-hx, -hy, hz], [hx, -hy, hz], [hx, -hy, -hz], [-hx, -hy, -hz]], [0, -1, 0]);
    add([[hx, -hy, -hz], [-hx, -hy, -hz], [0, hy, -hz]], [0, 0, -1]);
    add([[-hx, -hy, hz], [hx, -hy, hz], [0, hy, hz]], [0, 0, 1]);
  } else if (geo === 'oct') {
    const kx = hx * TAN_PI_8, kz = hz * TAN_PI_8;
    const ring = [[hx, -kz], [hx, kz], [kx, hz], [-kx, hz], [-hx, kz], [-hx, -kz], [-kx, -hz], [kx, -hz]];
    for (let i = 0; i < 8; i++) {
      const [x0, z0] = ring[i], [x1, z1] = ring[(i + 1) % 8];
      add([[x0, -hy, z0], [x1, -hy, z1], [x1, hy, z1], [x0, hy, z0]], [x0 + x1, 0, z0 + z1]);
    }
    add(ring.map(([x, z]) => [x, hy, z]), [0, 1, 0]);
    add([...ring].reverse().map(([x, z]) => [x, -hy, z]), [0, -1, 0]);
  }
  return faces;
}

function clipPolyOverlap2D(polyA, polyB, n) {
  const ref = Math.abs(n[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
  let ux = ref[1] * n[2] - ref[2] * n[1], uy = ref[2] * n[0] - ref[0] * n[2], uz = ref[0] * n[1] - ref[1] * n[0];
  const ul = Math.hypot(ux, uy, uz) || 1; ux /= ul; uy /= ul; uz /= ul;
  const vx = n[1] * uz - n[2] * uy, vy = n[2] * ux - n[0] * uz, vz = n[0] * uy - n[1] * ux;
  const to2D = p => [p[0] * ux + p[1] * uy + p[2] * uz, p[0] * vx + p[1] * vy + p[2] * vz];
  let out = polyA.map(to2D);
  const clip = polyB.map(to2D);
  for (let i = 0; i < clip.length && out.length >= 3; i++) {
    const a = clip[i], b = clip[(i + 1) % clip.length];
    const ex = b[0] - a[0], ey = b[1] - a[1];
    const inside = p => ex * (p[1] - a[1]) - ey * (p[0] - a[0]) >= -1e-9;
    const isect = (p, q) => {
      const dx = q[0] - p[0], dy = q[1] - p[1];
      const den = ex * dy - ey * dx;
      const t = Math.abs(den) > 1e-12 ? (ex * (a[1] - p[1]) - ey * (a[0] - p[0])) / den : 0;
      return [p[0] + dx * t, p[1] + dy * t];
    };
    const next = [];
    for (let j = 0; j < out.length; j++) {
      const cur = out[j], prev = out[(j + out.length - 1) % out.length];
      const curIn = inside(cur), prevIn = inside(prev);
      if (curIn) { if (!prevIn) next.push(isect(prev, cur)); next.push(cur); }
      else if (prevIn) next.push(isect(prev, cur));
    }
    out = next;
  }
  if (out.length < 3) return { area: 0, minSpan: 0 };
  let area2 = 0, minU = Infinity, maxU = -Infinity, minV = Infinity, maxV = -Infinity;
  for (let i = 0; i < out.length; i++) {
    const p = out[i], q = out[(i + 1) % out.length];
    area2 += p[0] * q[1] - q[0] * p[1];
    minU = Math.min(minU, p[0]); maxU = Math.max(maxU, p[0]);
    minV = Math.min(minV, p[1]); maxV = Math.max(maxV, p[1]);
  }
  return { area: 0.5 * Math.abs(area2), minSpan: Math.min(maxU - minU, maxV - minV) };
}

function nodeSpanAlong(node, dir) {
  const far = 200;
  const hi = node.project([node.center[0] + dir[0] * far, node.center[1] + dir[1] * far, node.center[2] + dir[2] * far]);
  const lo = node.project([node.center[0] - dir[0] * far, node.center[1] - dir[1] * far, node.center[2] - dir[2] * far]);
  const a = lo[0] * dir[0] + lo[1] * dir[1] + lo[2] * dir[2];
  const b = hi[0] * dir[0] + hi[1] * dir[1] + hi[2] * dir[2];
  return a <= b ? [a, b] : [b, a];
}

function isPointDeepInside(pt, big, margin = 0.014) {
  const c0 = big.project(pt);
  if (Math.hypot(c0[0] - pt[0], c0[1] - pt[1], c0[2] - pt[2]) > 1e-4) return false;
  for (const [ox, oy, oz] of [[margin, 0, 0], [-margin, 0, 0], [0, margin, 0], [0, -margin, 0], [0, 0, margin], [0, 0, -margin]]) {
    const q = [pt[0] + ox, pt[1] + oy, pt[2] + oz];
    const cq = big.project(q);
    if (Math.hypot(cq[0] - q[0], cq[1] - q[1], cq[2] - q[2]) > 1e-4) return false;
  }
  return true;
}

// Rotation- & primitive-aware 3D enclosure check (catches parts buried inside rotated/sloped/curved opaque hosts).
function isBuriedInside(small, big) {
  const bm = Array.isArray(big.part.mat) ? big.part.mat[0] : big.part.mat;
  if (bm?.lamp || big.part.tag === 'glass' || big.part.tag === 'window') return false;
  if (insideFraction(small.box, big.box) < 0.85) return false;
  const dirs = [];
  for (const dx of [-1, 0, 1]) for (const dy of [-1, 0, 1]) for (const dz of [-1, 0, 1]) {
    if (dx || dy || dz) dirs.push(applyR(small.R, [dx, dy, dz]));
  }
  for (const ax of [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]]) {
    dirs.push(applyR(big.R, ax));
  }
  for (const d of dirs) {
    const ext = small.project([small.center[0] + d[0] * 100, small.center[1] + d[1] * 100, small.center[2] + d[2] * 100]);
    if (!isPointDeepInside(ext, big, 0.014)) return false;
  }
  return true;
}

function defaultArgsFor(entity) {
  const args = {};
  for (const [k, p] of Object.entries(entity.params ?? {})) args[k] = p.default;
  if (entity.kind === 'vehicle' && VEHICLES[entity.id]) {
    const d = VEHICLES[entity.id];
    Object.assign(args, { len: d.len, w: d.w, h: d.h, pick: 0, hi: true });
  }
  return args;
}

function geometryRunsFor(entity, baseArgs, baseSlots) {
  const runs = [{ label: 'default', args: baseArgs, slots: baseSlots }];
  const params = entity.params ?? {};
  const lo = { ...baseArgs }, hi = { ...baseArgs };
  let hasRange = false;
  for (const [k, p] of Object.entries(params)) {
    if (entity.kind === 'vehicle' && ['len', 'w', 'h', 'pick', 'hi'].includes(k)) continue;
    if (Array.isArray(p.enum)) {
      for (const v of p.enum) if (v !== baseArgs[k]) runs.push({ label: `${k}=${v}`, args: { ...baseArgs, [k]: v }, slots: baseSlots });
    } else {
      if (p.min != null) { lo[k] = p.min; hasRange = true; }
      if (p.max != null) { hi[k] = p.max; hasRange = true; }
    }
  }
  if (hasRange) {
    runs.push({ label: 'min-params', args: lo, slots: baseSlots });
    runs.push({ label: 'max-params', args: hi, slots: baseSlots });
  }
  return runs;
}

function checkGeometryRun(entity, nodes, runLabel, pushOnce) {
  const grounded = entity.kind !== 'part' || GROUNDED_PARTS.has(entity.id);
  const ctx = runLabel === 'default' ? '' : ` [${runLabel}]`;
  let minY = Infinity, maxY = -Infinity, minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const n of nodes) {
    minY = Math.min(minY, n.trueMinY); maxY = Math.max(maxY, n.box[4]);
    minX = Math.min(minX, n.box[0]); maxX = Math.max(maxX, n.box[3]);
    minZ = Math.min(minZ, n.box[2]); maxZ = Math.max(maxZ, n.box[5]);
  }
  if (grounded) {
    if (minY > 0.02) pushOnce(`GROUND_CONTACT:hover`, 'error', 'GROUND_CONTACT', `Model${ctx} hovers ${(minY * 100).toFixed(1)} cm above y = 0 (minY = ${minY.toFixed(3)})`, 'Snap base/wheels/trunk to y = 0');
    else if (minY < -0.12) pushOnce(`GROUND_CONTACT:sink`, 'error', 'GROUND_CONTACT', `Model${ctx} sinks ${(-minY * 100).toFixed(1)} cm below y = 0 (minY = ${minY.toFixed(3)})`, 'Raise base so minY is near 0 (plinths may sink at most 10 cm)');
  }

  // 3D shape-surface BFS connectivity from ground-touching roots
  if (grounded && nodes.length > 1) {
    const supported = new Set();
    const queue = [];
    nodes.forEach((n, idx) => {
      if (n.trueMinY <= 0.02) { supported.add(idx); queue.push(idx); }
    });
    while (queue.length) {
      const cur = queue.shift();
      for (let j = 0; j < nodes.length; j++) {
        if (supported.has(j)) continue;
        if (shapeDist(nodes[cur], nodes[j], CONTACT_TOL) <= CONTACT_TOL) {
          supported.add(j);
          queue.push(j);
        }
      }
    }
    const remaining = new Set();
    for (let j = 0; j < nodes.length; j++) if (!supported.has(j)) remaining.add(j);
    while (remaining.size) {
      let bestIdx = -1, bestDist = Infinity;
      for (const j of remaining) {
        for (const s of supported) {
          if (boxDist(nodes[j].box, nodes[s].box) >= bestDist) continue;
          const d = shapeDist(nodes[j], nodes[s], bestDist);
          if (d < bestDist) { bestDist = d; bestIdx = j; }
        }
      }
      if (bestIdx < 0) bestIdx = [...remaining][0];
      const target = nodes[bestIdx];
      const tag = target.part.tag ?? target.part.geo;
      const label = `${tag}#${bestIdx}`;
      if (bestDist <= NEAR_MISS) {
        pushOnce(`GAP:${tag}:${bestIdx}`, 'error', 'HAIRLINE_GAP', `Part '${label}'${ctx} stops ${(bestDist * 100).toFixed(1)} cm short of its curved/sloped support`, 'Overlap neighbour surface by >= 1 cm');
      } else {
        pushOnce(`FLOAT:${tag}:${bestIdx}`, 'error', 'FLOATING_PART', `Part '${label}'${ctx} floats ${(bestDist * 100).toFixed(1)} cm from nearest supported surface`, 'Add a post, bracket, strut, or seat onto support');
      }
      const cQueue = [bestIdx];
      supported.add(bestIdx); remaining.delete(bestIdx);
      while (cQueue.length) {
        const u = cQueue.shift();
        for (const v of [...remaining]) {
          if (shapeDist(nodes[u], nodes[v], CONTACT_TOL) <= CONTACT_TOL) {
            supported.add(v); remaining.delete(v); cQueue.push(v);
          }
        }
      }
    }
  }

  // Structural brace / strut two-end anchor check
  for (let i = 0; i < nodes.length; i++) {
    const tag = nodes[i].part.tag;
    if (tag !== 'brace' && tag !== 'strut') continue;
    let anchors = grounded && nodes[i].trueMinY <= 0.02 ? 1 : 0;
    for (let j = 0; j < nodes.length; j++) {
      if (i === j) continue;
      if (shapeDist(nodes[i], nodes[j], CONTACT_TOL) <= CONTACT_TOL) anchors++;
      if (anchors >= 2) break;
    }
    if (anchors < 2) {
      pushOnce(`BRACE:${tag}:${i}`, 'error', 'FLOATING_PART', `Structural '${tag}#${i}'${ctx} anchors at only ${anchors} end(s) — other end hangs in thin air`, 'Angle and position brace/strut so both ends embed into host members');
    }
  }

  // Vehicle cargo-on-chassis daylight gap check
  if (entity.kind === 'vehicle') {
    const cargos = nodes.filter(n => n.part.tag === 'cargo');
    const chassis = nodes.filter(n => n.part.tag === 'chassis');
    if (cargos.length && chassis.length) {
      const cargoMinY = Math.min(...cargos.map(n => n.box[1]));
      const chassisMaxY = Math.max(...chassis.map(n => n.box[4]));
      const gap = cargoMinY - chassisMaxY;
      if (gap > 0.02) {
        pushOnce('CARGO_CHASSIS_GAP', 'error', 'HAIRLINE_GAP', `Cargo body on '${entity.id}' hovers ${(gap * 100).toFixed(1)} cm above chassis rails`, 'Raise chassis frame rails or add longitudinal sub-frame beams to seat the cargo floor');
      }
    }
  }

  // Landmark roof-piercing pylon poles, intersecting rooftop signs & unsupported sign overhangs
  if (entity.kind === 'landmark') {
    const poles = nodes.filter(n => n.part.tag === 'pole' && n.box[1] <= 0.5);
    const roofs = nodes.filter(n => n.part.tag === 'roof' || n.part.tag === 'canopy');
    for (const p of poles) {
      for (const r of roofs) {
        if (p.box[4] <= r.box[4] + 0.25 || p.box[1] >= r.box[1] - 0.25) continue;
        if (overlap1D(p.box[0], p.box[3], r.box[0], r.box[3]) <= 0.02 || overlap1D(p.box[2], p.box[5], r.box[2], r.box[5]) <= 0.02) continue;
        if (shapeDist(p, r, 0.002) <= 0.002) {
          pushOnce(`PIERCE:pole:${r.part.tag}`, 'error', 'PIERCING_PART', `Freestanding pylon 'pole'${ctx} pierces straight through '${r.part.tag}' overhang on '${entity.id}'`, 'Move pylon pole clear of overhanging roof/canopy eaves');
        }
      }
    }
    const signs = nodes.filter(n => n.part.tag === 'sign');
    const solids = nodes.filter(n => ['wall', 'penthouse', 'hvac'].includes(n.part.tag));
    for (const sg of signs) {
      const sb = sg.box, sVol = Math.max(1e-6, (sb[3] - sb[0]) * (sb[4] - sb[1]) * (sb[5] - sb[2]));
      for (const m of solids) {
        const ox = overlap1D(sb[0], sb[3], m.box[0], m.box[3]), oy = overlap1D(sb[1], sb[4], m.box[1], m.box[4]), oz = overlap1D(sb[2], sb[5], m.box[2], m.box[5]);
        if (ox > 0.25 && oy > 0.25 && oz > 0.25 && (ox * oy * oz) > 0.15 * sVol) {
          pushOnce(`PIERCE:sign:${m.part.tag}`, 'warn', 'PIERCING_PART', `Sign board on '${entity.id}'${ctx} deeply intersects '${m.part.tag}' mass (${(ox * oy * oz).toFixed(2)} m³ overlap)`, 'Offset sign proud of wall/penthouse or move rooftop mechanicals behind sign');
        }
      }
      if (sg.part.geo === 'box' && sb[1] > 3.5) {
        const spanX = sb[3] - sb[0], spanZ = sb[5] - sb[2], zWide = spanZ >= spanX, span = zWide ? spanZ : spanX;
        const hasGroundMast = poles.some(p => shapeDist(sg, p, 0.08) <= 0.08);
        if (span >= 4 && !hasGroundMast) {
          const cx = 0.5 * (sb[0] + sb[3]), cz = 0.5 * (sb[2] + sb[5]);
          let worstGap = 0;
          for (const dir of [-1, 1]) {
            const pt = zWide ? [cx, sb[1], cz + dir * 0.35 * span] : [cx + dir * 0.35 * span, sb[1], cz];
            let dMin = Infinity;
            for (const oth of nodes) {
              if (oth === sg || oth.part.tag === 'sign') continue;
              const q = oth.project(pt);
              const d = Math.hypot(q[0] - pt[0], q[1] - pt[1], q[2] - pt[2]);
              if (d < dMin) dMin = d;
            }
            if (dMin > worstGap) worstGap = dMin;
          }
          if (worstGap > 0.25) {
            pushOnce(`SIGN_WING:${sg.i}`, 'warn', 'FLOATING_PART', `Wide ${span.toFixed(1)} m rooftop sign on '${entity.id}'${ctx} has unsupported outer wing(s) hovering ${(worstGap * 100).toFixed(0)} cm above roof`, 'Add rooftop support legs/pedestal under outer sign wings');
          }
        }
      }
    }
  }

  // Coplanar Z-fighting (including thin flush plates on rotated/sloped faces) & 3D Buried parts
  const facesByNode = nodes.map(planarFacesOf);
  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      const A = nodes[i], B = nodes[j];
      if (boxDist(A.box, B.box) > 0.003) continue;
      const facesA = facesByNode[i], facesB = facesByNode[j];
      let zFought = false;
      for (let fa = 0; fa < facesA.length && !zFought; fa++) {
        const fA = facesA[fa];
        if (fA.normal[1] < -0.98 && Math.abs(fA.offset) <= 0.025) continue;
        for (let fb = 0; fb < facesB.length; fb++) {
          const fB = facesB[fb];
          if (fA.normal[0] * fB.normal[0] + fA.normal[1] * fB.normal[1] + fA.normal[2] * fB.normal[2] < 0.9994) continue;
          if (Math.abs(fA.offset - fB.offset) > 0.0018) continue;
          if (matKey(fA.mat, entity.kind) === matKey(fB.mat, entity.kind)) continue;
          const ov = clipPolyOverlap2D(fA.poly, fB.poly, fA.normal);
          if (ov.area > 0.04 && ov.minSpan > 0.08) {
            pushOnce(`ZFIGHT:${A.part.tag ?? A.part.geo}#${i}:${B.part.tag ?? B.part.geo}#${j}`, 'error', 'COPLANAR_Z_FIGHT', `Same-facing planes of '${A.part.tag ?? A.part.geo}#${i}' and '${B.part.tag ?? B.part.geo}#${j}'${ctx} z-fight over ${ov.area.toFixed(2)} m² (offset ${fA.offset.toFixed(3)} m)`, 'Make inset/trim stand >= 5 mm proud of host face');
            zFought = true;
            break;
          }
        }
      }
      const areaA = boxArea(A.box), areaB = boxArea(B.box);
      const [small, smallIdx, big, bigIdx] = areaA <= areaB ? [A, i, B, j] : [B, j, A, i];
      if (areaA !== areaB && isBuriedInside(small, big)) {
        pushOnce(`BURIED:${small.part.tag ?? small.part.geo}#${smallIdx}:${big.part.tag ?? big.part.geo}#${bigIdx}`, 'warn', 'BURIED_PART', `Part '${small.part.tag ?? small.part.geo}#${smallIdx}'${ctx} is completely enclosed inside '${big.part.tag ?? big.part.geo}#${bigIdx}'`, 'Pull feature proud of surface or remove invisible part');
      }
    }
  }

  return { minX, maxX, minY, maxY, minZ, maxZ, facesByNode };
}

function checkInsetContrast(entity, bs, pal, variantLabel, pushOnce) {
  const INSET_TAGS = new Set(['door', 'window', 'glass', 'stripe', 'decal', 'grille', 'screen', 'wing']);
  const HOST_TAGS = new Set(['wall', 'body', 'cabin', 'cargo']);
  for (const ins of bs) {
    if (!INSET_TAGS.has(ins.part.tag)) continue;
    const ib = ins.box, dims = [ib[3] - ib[0], ib[4] - ib[1], ib[5] - ib[2]];
    if (Math.min(...dims) > 0.35) continue;
    for (const host of bs) {
      if (host === ins || !HOST_TAGS.has(host.part.tag)) continue;
      if (boxArea(host.box) < boxArea(ib) * 2) continue;
      if (boxDist(ib, host.box) > 0.03) continue;
      const dE = deltaE76(resolveHex(ins.part.mat, entity.kind, pal), resolveHex(host.part.mat, entity.kind, pal));
      if (dE < 10) {
        const ctx = variantLabel ? ` (${variantLabel})` : '';
        pushOnce(`CONTRAST:${ins.part.tag}:${host.part.tag}`, 'warn', 'LOW_CONTRAST_INSET', `Thin '${ins.part.tag}' on '${entity.id}'${ctx} has low contrast against '${host.part.tag}' (ΔE = ${dE.toFixed(1)} < 10)`, 'Use a contrasting material slot or adaptive colour expression');
        break;
      }
    }
  }
}

export function auditEntity(entity, { lookup = () => null, appearance = true } = {}) {
  const issues = [];
  const seen = new Set();
  const push = (severity, code, message, fix) => issues.push({ severity, code, message, fix });
  const pushOnce = (key, severity, code, message, fix) => {
    if (seen.has(key)) return;
    seen.add(key);
    issues.push({ severity, code, message, fix });
  };

  const val = validateEntity(entity, { lookup });
  if (!val.ok) {
    for (const e of val.errors) push('error', 'SCHEMA_INVALID', e, 'Fix schema, expression, or roster contract error');
    return summarize(entity, issues, null);
  }

  const prog = compileEntity(entity, { lookup: id => (id === entity.id ? entity : lookup(id)), cache: new Map() });
  const baseSlots = entity.kind === 'landmark' ? BASE_LANDMARK_PAL : { ...DEFAULT_PROP_PAL, ...BASE_LANDMARK_PAL };
  const baseArgs = defaultArgsFor(entity);
  const parts = toParts(prog, baseArgs, { slots: baseSlots });
  const nodes = buildShapeNodes(parts);

  if (!nodes.length) {
    push('error', 'FEW_PARTS', 'Entity produces 0 meshes', 'Add sculpted mesh parts');
    return summarize(entity, issues, { meshes: 0 });
  }

  // 1–3. Ground contact, 3D shape-surface BFS connectivity, structural braces, z-fighting & buried-part checks across param corners
  const ext = checkGeometryRun(entity, nodes, 'default', pushOnce);
  const facesByNode = ext.facesByNode;
  for (const run of geometryRunsFor(entity, baseArgs, baseSlots).slice(1)) {
    const rParts = toParts(prog, run.args, { slots: run.slots });
    const rNodes = buildShapeNodes(rParts);
    if (rNodes.length) checkGeometryRun(entity, rNodes, run.label, pushOnce);
  }

  // 4. Anti-cube complexity & sculpted geometry checks
  const minNeed = MIN_MESHES[entity.kind] ?? 1;
  if (nodes.length < minNeed) {
    push('error', 'FEW_PARTS', `${entity.kind} '${entity.id}' has only ${nodes.length} meshes (minimum ${minNeed})`, 'Regenerate with layered kitbash sub-assemblies instead of simple cubes');
  }

  if (entity.kind === 'vehicle' || entity.id === 'cruiser') {
    const hullParts = nodes.filter(n => !['tyre', 'rim', 'hub', 'axle', 'headlamp', 'taillamp', 'brakelamp', 'indicator', 'beacon'].includes(n.part.tag));
    const sculpted = hullParts.some(n => ['rbox', 'wedge', 'gable', 'oct', 'cyl16', 'barrel'].includes(n.part.geo));
    if (!sculpted) {
      push('warn', 'RAW_CUBE_HULL', `Vehicle '${entity.id}' uses only raw sharp 'box' primitives for its hull`, 'Use rbox and wedge for sculpted coachwork, sloped windshields, and bumpers');
    }
    if (entity.kind === 'vehicle' && hullParts.length < 10) {
      push('warn', 'FEW_PARTS', `Vehicle '${entity.id}' has only ${hullParts.length} coachwork/chassis parts`, 'Add bumpers, grille, sloped windshield, side glass/pillars, mirrors, and trim');
    }
  } else if (entity.kind === 'landmark') {
    const archParts = nodes.filter(n => !['apron', 'cone', 'leaf', 'trunk', 'tyre', 'rim', 'hub'].includes(n.part.tag));
    const sculpted = archParts.some(n => ['rbox', 'wedge', 'gable', 'oct', 'cyl16', 'barrel', 'pyr', 'cone'].includes(n.part.geo));
    if (!sculpted) {
      push('warn', 'RAW_CUBE_HULL', `Landmark '${entity.id}' uses only raw sharp 'box' primitives for its architecture`, 'Use rbox, gable, pyr, barrel, wedge, or cyl16 for rooflines, fascias, canopies, and columns');
    }
  }

  // Landmark lane clearance check (front is -x)
  if (entity.kind === 'landmark') {
    const ros = rosterOf(entity.id);
    if (ros?.lock?.hd && ext.minX < -ros.lock.hd - 2.6) {
      push('error', 'FOOTPRINT_BOUNDS', `Landmark '${entity.id}' reaches x = ${ext.minX.toFixed(2)} m past front apron limit -${(ros.lock.hd + 2.6).toFixed(1)} m`, 'Keep front parts inside local x >= -(hd + 2.6)');
    }
  }

  const size = [+(ext.maxX - ext.minX).toFixed(3), +(ext.maxY - ext.minY).toFixed(3), +(ext.maxZ - ext.minZ).toFixed(3)];
  if (!appearance) return summarize(entity, issues, { meshes: nodes.length, minY: +ext.minY.toFixed(3), size });

  // 5. Appearance, Palette Hierarchy & Multi-Variant Contrast Sweep
  const areaByKey = new Map();
  let totalArea = 0;
  for (const n of nodes) {
    const a = boxArea(n.box);
    totalArea += a;
    const k = matKey(n.part.mat, entity.kind);
    areaByKey.set(k, (areaByKey.get(k) ?? 0) + a);
  }

  if ((entity.kind === 'vehicle' || entity.kind === 'landmark') && totalArea > 0) {
    const significant = [...areaByKey.entries()].filter(([, a]) => a / totalArea >= 0.015);
    const maxShare = Math.max(...[...areaByKey.values()].map(a => a / totalArea));
    if (areaByKey.size < 3 || significant.length < 2 || maxShare > 0.80) {
      push('warn', 'PALETTE_FLAT', `'${entity.id}' has flat material hierarchy (${areaByKey.size} total materials, dominant covers ${(maxShare * 100).toFixed(0)}%)`, 'Apply 60/30/10 hierarchy: primary paint/wall, dark chassis/roof/trim, glass & self-lit accents');
    }
  }

  // Vehicle wheel & axle distribution, lamp role detail, blank cargo faces + all `pick` paint variants
  if (entity.kind === 'vehicle') {
    const def = VEHICLES[entity.id];
    const tyres = nodes.filter(n => n.part.tag === 'tyre');
    const rims = nodes.filter(n => n.part.tag === 'rim');
    const hubs = nodes.filter(n => n.part.tag === 'hub');
    if (rims.length < tyres.length || hubs.length < tyres.length) {
      push('warn', 'ROLE_DETAIL', `Vehicle '${entity.id}' wheels lack separate rim/hub meshes (${tyres.length} tyres, ${rims.length} rims, ${hubs.length} hubs)`, 'Build every wheel with tyre + rim + hub');
    } else if (tyres.length && rims.length) {
      const dE = deltaE76(resolveHex(tyres[0].part.mat, 'vehicle'), resolveHex(rims[0].part.mat, 'vehicle'));
      if (dE < 20) push('warn', 'ROLE_DETAIL', `Vehicle '${entity.id}' tyre and rim colours barely contrast (ΔE = ${dE.toFixed(1)})`, 'Pair dark rubber tyre with metallic/light rim');
    }
    const tyreOuter = tyres.reduce((m, n) => Math.max(m, Math.abs(n.box[0]), Math.abs(n.box[3])), 0);
    if (def && tyreOuter < def.w / 2 - 0.04) {
      push('warn', 'WHEEL_CLEARANCE', `Vehicle '${entity.id}' tyres (outer X = ${tyreOuter.toFixed(2)} m) are recessed too far inside ${def.w} m width`, 'Place wheels flush or proud at outer flanks so they read in side view');
    }
    if (def && tyres.length) {
      const zSorted = tyres.map(n => n.center[2]).sort((a, b) => a - b);
      const axleZs = [];
      for (const z of zSorted) {
        if (!axleZs.length || Math.abs(z - axleZs[axleZs.length - 1]) > 0.25) axleZs.push(z);
        else axleZs[axleZs.length - 1] = 0.5 * (axleZs[axleZs.length - 1] + z);
      }
      const wantAxles = entity.id === 'freighter' ? 3 : 2;
      if (axleZs.length < wantAxles) {
        push('error', 'AXLE_SPAN', `Vehicle '${entity.id}' has only ${axleZs.length} distinct axle station(s) along Z (expected ${wantAxles})`, 'Separate axles along Z into distinct steer, drive, and rear stations');
      } else {
        const frontOh = axleZs[0] - (-def.len / 2), rearOh = def.len / 2 - axleZs[axleZs.length - 1];
        const maxSpan = Math.max(...axleZs.slice(1).map((z, k) => z - axleZs[k]));
        const maxAllow = wantAxles >= 3 ? 0.66 * def.len : 0.70 * def.len;
        if (frontOh > 0.30 * def.len || rearOh > 0.30 * def.len || maxSpan > maxAllow) {
          push('error', 'AXLE_SPAN', `Vehicle '${entity.id}' axles [${axleZs.map(z => z.toFixed(2)).join(', ')}] leave an unsupported span of ${maxSpan.toFixed(2)} m (front/rear overhang ${frontOh.toFixed(2)}/${rearOh.toFixed(2)} m on ${def.len} m hull)`, 'Distribute steer, tractor drive, and rear axles proportionally across the chassis');
        } else if (entity.id === 'freighter' && axleZs[1] > 0) {
          push('error', 'AXLE_SPAN', `Semi '${entity.id}' middle drive axle sits at z = ${axleZs[1].toFixed(2)} m behind midship instead of under the tractor fifth wheel`, 'Place the second axle under the tractor rear frame / fifth wheel (z <= 0)');
        }
      }
    }
    const lamps = nodes.filter(n => ['headlamp', 'taillamp', 'brakelamp', 'beacon'].includes(n.part.tag));
    for (const l of lamps) {
      const m = Array.isArray(l.part.mat) ? l.part.mat[0] : l.part.mat;
      if (!m?.lamp) {
        push('warn', 'ROLE_DETAIL', `Lamp part '${l.part.tag}' on '${entity.id}' is not self-lit (lamp: true)`, 'Set lamp: true on headlamps, taillamps, brake lamps, and beacons');
        break;
      }
    }
    const picks = entity.params?.pick?.enum ?? (Array.isArray(entity.consts?.palette) ? entity.consts.palette.map((_, i) => i) : [0]);
    for (const pk of picks) {
      const pkParts = pk === 0 ? parts : toParts(prog, { ...baseArgs, pick: pk }, { slots: baseSlots });
      const pkBoxes = pk === 0 ? nodes : boxes(pkParts);
      checkInsetContrast(entity, pkBoxes, BASE_LANDMARK_PAL, picks.length > 1 ? `pick=${pk}` : '', pushOnce);
    }
  } else if (entity.kind === 'landmark') {
    for (const rp of ROUTE_LANDMARK_PALS) {
      rp.walls.forEach((wallHex, wi) => {
        const pal = { ...BASE_LANDMARK_PAL, ...rp, wall: wallHex };
        checkInsetContrast(entity, nodes, pal, `${rp.route}:wall[${wi}]`, pushOnce);
      });
    }
  } else {
    checkInsetContrast(entity, nodes, BASE_LANDMARK_PAL, '', pushOnce);
  }

  // 6. TerraAgent-style FLAT_SURFACE check on large blank vehicle flanks & road-facing landmark walls
  if (entity.kind === 'vehicle' || entity.kind === 'landmark') {
    nodes.forEach((host, hi) => {
      const tag = host.part.tag;
      if (entity.kind === 'vehicle' ? !['cargo', 'body'].includes(tag) : tag !== 'wall') return;
      for (const f of facesByNode[hi]) {
        if (Math.abs(f.normal[1]) > 0.35) continue;
        if (entity.kind === 'landmark' && f.normal[0] > -0.85) continue;
        const fm = f.mat;
        if (fm?.facade || fm?.sign || fm?.disk || fm?.flag !== undefined || fm?.lamp) continue;
        const minArea = entity.kind === 'vehicle' ? 6.5 : 24;
        if (f.area < minArea) continue;
        // Skip face when another major hull/cabin/alcove covers >= 35% of it on its outward side
        let covered = false;
        for (let oi = 0; oi < nodes.length; oi++) {
          if (oi === hi) continue;
          const oth = nodes[oi];
          if (boxDist(host.box, oth.box) > 0.12) continue;
          const dc = (oth.center[0] - host.center[0]) * f.normal[0] + (oth.center[1] - host.center[1]) * f.normal[1] + (oth.center[2] - host.center[2]) * f.normal[2];
          if (dc <= 0.05) continue;
          const [, oHi] = nodeSpanAlong(oth, f.normal);
          if (oHi < f.offset + 0.15) continue;
          for (const oface of facesByNode[oi]) {
            if (Math.abs(oface.normal[0] * f.normal[0] + oface.normal[1] * f.normal[1] + oface.normal[2] * f.normal[2]) < 0.7) continue;
            if (clipPolyOverlap2D(f.poly, oface.poly, f.normal).area >= 0.35 * f.area) { covered = true; break; }
          }
          if (covered) break;
        }
        if (covered) continue;
        const need = entity.kind === 'vehicle'
          ? (f.area >= 24 ? 5 : f.area >= 12 ? 2 : 1)
          : (f.area >= 50 ? 3 : 2);
        const feats = [];
        for (let oi = 0; oi < nodes.length; oi++) {
          if (oi === hi) continue;
          const feat = nodes[oi];
          if (['tyre', 'rim', 'hub', 'axle', 'chassis', 'plinth', 'apron'].includes(feat.part.tag)) continue;
          if (boxDist(host.box, feat.box) > 0.08) continue;
          const [, fHi] = nodeSpanAlong(feat, f.normal);
          if (fHi < f.offset - 0.015) continue;
          const uAxis = Math.abs(f.normal[0]) > 0.7 ? 2 : 0;
          if (overlap1D(host.box[uAxis], host.box[uAxis + 3], feat.box[uAxis], feat.box[uAxis + 3]) < 0.04) continue;
          if (overlap1D(host.box[1], host.box[4], feat.box[1], feat.box[4]) < 0.04) continue;
          feats.push(feat);
        }
        const faceH = host.box[4] - host.box[1], midY = 0.5 * (host.box[1] + host.box[4]);
        const upperFeats = feats.filter(ft => ft.box[4] > midY + 0.25).length;
        if (feats.length < need || (entity.kind === 'vehicle' && f.area >= 18 && faceH >= 2.2 && upperFeats < 2)) {
          const side = Math.abs(f.normal[0]) > 0.7 ? (f.normal[0] > 0 ? '+x' : '-x') : (f.normal[2] > 0 ? '+z' : '-z');
          pushOnce(`FLAT:${tag}:${side}`, 'warn', 'FLAT_SURFACE', `Large ${f.area.toFixed(1)} m² '${tag}' (${side}) face on '${entity.id}' is visually blank (${feats.length}/${need} mounted features, ${upperFeats} in upper half)`, 'Break up large slabs with vertical stiffener ribs, rub-rails, windows, shutters, or framed signage');
        }
      }
    });
  }

  return summarize(entity, issues, {
    meshes: nodes.length,
    materials: areaByKey.size,
    minY: +ext.minY.toFixed(3),
    size,
  });
}

function summarize(entity, issues, stats) {
  const errors = issues.filter(i => i.severity === 'error').length;
  const warnings = issues.filter(i => i.severity === 'warn').length;
  return {
    id: entity.id,
    kind: entity.kind,
    label: entity.label ?? entity.id,
    pass: errors === 0,
    errors,
    warnings,
    stats,
    issues,
  };
}

export function formatEntityReport(r, { quiet = false } = {}) {
  const badge = r.errors ? 'FAIL' : r.warnings ? 'WARN' : 'PASS';
  const s = r.stats ? `meshes=${r.stats.meshes} mats=${r.stats.materials ?? '-'} minY=${r.stats.minY ?? '-'} size=${(r.stats.size ?? []).join('x')}m` : 'invalid';
  const head = `[${badge}] ${r.kind.padEnd(9)} ${r.id.padEnd(18)} ${s} · ${r.errors} err, ${r.warnings} warn`;
  if (quiet || !r.issues.length) return head;
  const lines = [head];
  for (const iss of r.issues) {
    lines.push(`  ${iss.severity === 'error' ? '✖' : '▲'} ${iss.code}: ${iss.message}  (fix: ${iss.fix})`);
  }
  return lines.join('\n');
}

export function selfTestAudit() {
  const failures = [];
  let checks = 0;
  const expectCode = (name, entity, wantCodes, lookup = () => null) => {
    checks++;
    const codes = Array.isArray(wantCodes) ? wantCodes : [wantCodes];
    const r = auditEntity(entity, { lookup });
    if (!r.issues.some(i => codes.includes(i.code))) failures.push({ fixture: name, detail: `expected ${codes.join('|')}, got ${JSON.stringify(r.issues)}` });
  };

  // 1. Floating cone
  expectCode('floating-cone', {
    id: 'test-float', kind: 'prop', v: 1, slots: { m: {} }, debris: 'm',
    parts: [
      { geo: 'cyl', tag: 'base', mat: 'm', s: [0.4, 0.2, 0.4], at: [0, 0.1, 0] },
      { geo: 'cone', tag: 'mid', mat: 'm', s: [0.3, 0.4, 0.3], at: [0, 0.35, 0] },
      { geo: 'cone', tag: 'top', mat: 'm', s: [0.4, 0.8, 0.4], at: [0, 1.35, 0] },
    ],
  }, 'FLOATING_PART');

  // 2. Hovering above ground
  expectCode('hover-prop', {
    id: 'test-hover', kind: 'prop', v: 1, slots: { m: {} }, debris: 'm',
    parts: [
      { geo: 'rock', tag: 'a', mat: 'm', s: [0.5, 0.5, 0.5], at: [0, 0.8, 0] },
      { geo: 'rock', tag: 'b', mat: 'm', s: [0.4, 0.4, 0.4], at: [0.3, 0.9, 0] },
      { geo: 'rock', tag: 'c', mat: 'm', s: [0.3, 0.3, 0.3], at: [-0.2, 0.85, 0] },
    ],
  }, 'GROUND_CONTACT');

  // 3. Single-cone cube/placeholder prop
  expectCode('one-cone-prop', {
    id: 'test-few', kind: 'prop', v: 1, slots: { m: {} }, debris: 'm',
    parts: [{ geo: 'cone', tag: 'canopy', mat: 'm', s: [1, 1, 1], at: [0, 0.5, 0] }],
  }, 'FEW_PARTS');

  // 4. Coplanar Z-fighting
  expectCode('coplanar-z', {
    id: 'test-zfight', kind: 'prop', v: 1, slots: { m1: {}, m2: {} }, debris: 'm1',
    parts: [
      { geo: 'box', tag: 'wall', mat: 'm1', s: [2, 2, 2], at: [0, 1, 0] },
      { geo: 'box', tag: 'stripe', mat: 'm2', s: [1, 0.5, 2], at: [0, 1, 0] },
      { geo: 'box', tag: 'cap', mat: 'm1', s: [2.2, 0.2, 2.2], at: [0, 2.05, 0] },
    ],
  }, 'COPLANAR_Z_FIGHT');

  // 5. Low-contrast inset
  expectCode('low-contrast', {
    id: 'test-contrast', kind: 'part', v: 1,
    parts: [
      { geo: 'rbox', tag: 'body', mat: { color: 0x30343a }, s: [2, 1.2, 4], at: [0, 0.6, 0] },
      { geo: 'box', tag: 'stripe', mat: { color: 0x33373d }, s: [2.02, 0.25, 3], at: [0, 0.6, 0] },
    ],
  }, 'LOW_CONTRAST_INSET');

  // 6. Sloped-wedge air-pocket trap (AABB overlaps upper-front corner of wedge, but true wedge ramp is 30 cm away)
  expectCode('sloped-wedge-floating-visor', {
    id: 'test-wedge-gap', kind: 'prop', v: 1, slots: { m: {} }, debris: 'm',
    parts: [
      { geo: 'box', tag: 'base', mat: 'm', s: [2, 1, 1], at: [0, 0.5, 0.5] },
      { geo: 'wedge', tag: 'glass', mat: 'm', s: [1.8, 1, 1], at: [0, 1.45, 0] },
      { geo: 'box', tag: 'visor', mat: 'm', s: [1.6, 0.1, 0.2], at: [0, 1.85, -0.35] },
    ],
  }, ['FLOATING_PART', 'HAIRLINE_GAP']);

  // 7. Diagonal cylinder corner trap (AABB [0.18..0.24]^2 overlaps [-0.20..0.20]^2 trunk box, but radial dist > 0.20)
  expectCode('diagonal-twig-outside-cylinder', {
    id: 'test-cyl-corner', kind: 'prop', v: 1, slots: { m: {} }, debris: 'm',
    parts: [
      { geo: 'cyl16', tag: 'trunk', mat: 'm', s: [0.2, 2, 0.2], at: [0, 1, 0] },
      { geo: 'cyl', tag: 'branch', mat: 'm', s: [0.03, 0.6, 0.03], at: [0, 1.2, 0], rot: [0.5, 0, 0] },
      { geo: 'box', tag: 'twig', mat: 'm', s: [0.06, 0.2, 0.06], at: [0.21, 1.5, 0.21] },
    ],
  }, 'HAIRLINE_GAP');

  // 8. One-ended dangling lamp brace (touches arm at top, hangs in air away from mast)
  expectCode('dangling-lamp-brace', {
    id: 'test-dangling-brace', kind: 'furniture', v: 1, slots: { mast: {} }, debris: 'mast',
    parts: [
      { geo: 'oct', tag: 'base', mat: 'mast', s: [0.5, 0.4, 0.5], at: [0, 0.2, 0] },
      { geo: 'cyl16', tag: 'pole', mat: 'mast', s: [0.12, 6, 0.12], at: [0, 3, 0] },
      { geo: 'rbox', tag: 'arm', mat: 'mast', s: [3, 0.14, 0.14], at: [-1.4, 5.95, 0] },
      { geo: 'box', tag: 'brace', mat: 'mast', s: [1.2, 0.08, 0.08], at: [-1.4, 5.65, 0], rot: [0, 0, 0.46] },
    ],
  }, 'FLOATING_PART');

  // 9. Raw-cube landmark (uses only sharp 'box' primitives)
  expectCode('raw-cube-landmark', {
    id: 'test-cube-lm', kind: 'landmark', v: 1,
    parts: Array.from({ length: 14 }, (_, i) => ({
      geo: 'box', tag: i === 0 ? 'apron' : 'wall', mat: i % 2 ? 'wall' : 'roof',
      s: [4 - i * 0.1, 0.4, 4 - i * 0.1], at: [0, 0.2 + i * 0.35, 0],
    })),
  }, 'RAW_CUBE_HULL');

  // 10. Rotated / group-transformed coplanar Z-fighting
  expectCode('rotated-coplanar-z', {
    id: 'test-rot-zfight', kind: 'prop', v: 1, slots: { m1: {}, m2: {} }, debris: 'm1',
    parts: [
      { group: {}, rot: [0, 0.52, 0], do: [
        { geo: 'rbox', tag: 'wall', mat: 'm1', s: [2, 2, 2], at: [0, 1, 0] },
        { geo: 'box', tag: 'panel', mat: 'm2', s: [0.9, 0.7, 2], at: [0, 1, 0] },
        { geo: 'oct', tag: 'cap', mat: 'm1', s: [2.1, 0.2, 2.1], at: [0, 2.05, 0] },
      ] },
    ],
  }, 'COPLANAR_Z_FIGHT');

  // 11. Buried part inside rotated opaque rbox
  expectCode('rotated-buried-part', {
    id: 'test-rot-buried', kind: 'prop', v: 1, slots: { m1: {}, m2: {} }, debris: 'm1',
    parts: [
      { group: {}, rot: [0, 0.45, 0], do: [
        { geo: 'rbox', tag: 'hull', mat: 'm1', s: [2, 1.8, 2], at: [0, 0.9, 0] },
        { geo: 'box', tag: 'hidden', mat: 'm2', s: [0.5, 0.5, 0.5], at: [0, 0.9, 0] },
        { geo: 'oct', tag: 'cap', mat: 'm1', s: [2.1, 0.2, 2.1], at: [0, 1.85, 0] },
      ] },
    ],
  }, 'BURIED_PART');

  // 12. Exact 12-plane DodecahedronGeometry ('rock') flat-face gap (0.86 along face normal > 0.795 inradius, though < 1.0 sphere)
  expectCode('dodec-face-gap', {
    id: 'test-dodec-gap', kind: 'prop', v: 1, slots: { m: {} }, debris: 'm',
    parts: [
      { geo: 'rock', tag: 'boulder', mat: 'm', s: [1, 1, 1], at: [0, 0.93, 0] },
      { geo: 'box', tag: 'spur', mat: 'm', s: [0.1, 0.1, 0.1], at: [0.51, 0.93, 0.825] },
      { geo: 'rock', tag: 'base', mat: 'm', s: [0.5, 0.3, 0.5], at: [-0.5, 0.28, 0] },
    ],
  }, ['HAIRLINE_GAP', 'FLOATING_PART']);

  // 13. Semi freighter with missing tractor drive axle & blank upper cargo wall
  const seedLookup = id => SEED.find(e => e.id === id) ?? null;
  const baseFreighter = SEED.find(e => e.id === 'freighter');
  if (baseFreighter) {
    const badAxle = {
      ...structuredClone(baseFreighter),
      parts: baseFreighter.parts
        .filter(p => p.tag !== 'rib' && p.tag !== 'rail' && !(p.for === 'i' && p.do?.[0]?.tag === 'rib') && !(p.tag === 'stripe' && String(p.at?.[1]).includes('boxH')))
        .map(p => (p.use === 'veh-wheels' ? { ...p, with: { ...p.with, zs: ['zf + 0.92', 'len * 0.48 - 1.2', 'len * 0.48 - 2.45'] } } : p)),
    };
    expectCode('freighter-missing-tractor-axle', badAxle, 'AXLE_SPAN', seedLookup);
    expectCode('freighter-blank-cargo-wall', badAxle, 'FLAT_SURFACE', seedLookup);
  }

  // 15. Thin 8 mm trim flush with sloped 45° wedge inside nested rotated group (catches sub-15 mm sloped Z-fighting)
  const s2 = Math.SQRT1_2;
  expectCode('sloped-wedge-thin-coplanar-zfight', {
    id: 'test-sloped-zfight', kind: 'prop', v: 1, slots: { m1: {}, m2: {} }, debris: 'm1',
    parts: [
      { group: {}, rot: [0, 0.4, 0], do: [
        { geo: 'wedge', tag: 'glass', mat: 'm1', s: [2, 1, 1], at: [0, 0.5, 0] },
        { geo: 'box', tag: 'trim', mat: 'm2', s: [1.2, 0.008, 0.8], at: [0, 0.5 - 0.004 * s2, 0.004 * s2], rot: [-Math.PI / 4, 0, 0] },
        { geo: 'box', tag: 'base', mat: 'm1', s: [2, 0.1, 1], at: [0, 0.05, 0] },
      ] },
    ],
  }, 'COPLANAR_Z_FIGHT');

  // 16. Landmark freestanding pylon pole piercing through overhanging roof
  expectCode('landmark-pole-piercing-roof', {
    id: 'test-pierce-roof', kind: 'landmark', v: 1, anchor: 'base',
    parts: [
      { geo: 'rbox', tag: 'wall', mat: 'wall', s: [5, 3, 12], at: [1, 0, 0] },
      { geo: 'rbox', tag: 'roof', mat: 'roof', s: [8, 0.3, 13], at: [-0.5, 3, 0] },
      { geo: 'cyl16', tag: 'pole', mat: 'metal', s: [0.15, 7, 0.15], at: [-3.8, 0, 5.5] },
      { sign: { style: 'neon', w: 3.5, h: 1.5 }, at: [-3.8, 7, 5.5] },
      ...Array.from({ length: 10 }, (_, i) => ({ geo: 'box', tag: 'mullion', mat: 'trim', s: [0.1, 1.2, 0.1], at: [-1.55, 0.9, -4.5 + i] })),
    ],
  }, 'PIERCING_PART');

  // 17. Wide rooftop sign balanced on sharp gable apex without outer wing supports
  expectCode('rooftop-sign-unsupported-wings', {
    id: 'test-gable-sign', kind: 'landmark', v: 1, anchor: 'base',
    parts: [
      { geo: 'rbox', tag: 'wall', mat: { facade: [8, 3] }, s: [6, 6, 16], at: [1, 0, 0] },
      { geo: 'gable', tag: 'roof', mat: 'roof', s: [6.4, 1.8, 9], at: [1, 6, 0], rot: [0, 'PI / 2', 0] },
      { sign: { style: 'red', w: 7.5, h: 1.6 }, at: [1, 7.65, 0] },
      ...Array.from({ length: 11 }, (_, i) => ({ geo: 'oct', tag: 'column', mat: 'trim', s: [0.3, 3, 0.3], at: [-2.5, 0, -5 + i] })),
    ],
  }, 'FLOATING_PART');

  // 18. Multi-paint palette dark variant low-contrast inset
  if (baseFreighter) {
    const baseSedan = SEED.find(e => e.id === 'sedan');
    if (baseSedan) {
      const badPaletteSedan = {
        ...structuredClone(baseSedan),
        parts: [
          ...baseSedan.parts,
          { geo: 'box', tag: 'decal', mat: { color: 0x202025 }, s: ['w * 0.958', 0.16, 1.4], at: [0, 0.72, 0] },
        ],
      };
      expectCode('sedan-palette-dark-contrast', badPaletteSedan, 'LOW_CONTRAST_INSET', seedLookup);
    }
  }

  // 19. Known-good multi-part prop passes with 0 errors and 0 warnings
  checks++;
  const good = auditEntity({
    id: 'test-good-rock', kind: 'prop', v: 1, slots: { m1: {}, m2: {} }, debris: 'm1',
    parts: [
      { geo: 'rock', tag: 'main', mat: 'm1', s: [1.1, 0.8, 0.9], at: [0, 0.74, 0] },
      { geo: 'rock', tag: 'side', mat: 'm2', s: [0.65, 0.5, 0.6], at: [0.64, 0.46, 0.18] },
      { geo: 'rock', tag: 'talus', mat: 'm1', s: [0.4, 0.3, 0.4], at: [-0.58, 0.27, -0.2] },
    ],
  });
  if (!good.pass || good.warnings > 0) failures.push({ fixture: 'good-rock', detail: JSON.stringify(good.issues) });

  failures.count = checks;
  return failures;
}

export function runAuditCli(argv) {
  const flag = n => argv.includes(n);
  const val = n => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : undefined; };
  if (flag('--self-test')) {
    const failures = selfTestAudit();
    if (failures.length) { console.log(JSON.stringify({ ok: false, failures }, null, 2)); return 1; }
    console.log(JSON.stringify({ ok: true, selfTest: failures.count }));
    return 0;
  }
  const byId = new Map(SEED.map(e => [e.id, e]));
  const lookup = id => byId.get(id) ?? null;
  let targets = argv.filter((a, i) => !a.startsWith('--') && argv[i - 1] !== '--category' && argv[i - 1] !== '--entity');
  if (val('--entity')) targets.push(val('--entity'));
  if (flag('--all')) targets = SEED.map(e => e.id);
  else if (val('--category')) targets = SEED.filter(e => e.kind === val('--category')).map(e => e.id);

  if (!targets.length) {
    console.error('usage: audit-entities.mjs <id...> | --category <vehicle|landmark|prop|furniture|gantry|part> | --all [--strict] [--quiet] [--json] [--geometry-only] | --self-test');
    return 2;
  }

  const reports = [];
  for (const id of targets) {
    const e = byId.get(id);
    if (!e) { console.error(`unknown entity "${id}"`); return 2; }
    reports.push(auditEntity(e, { lookup, appearance: !flag('--geometry-only') }));
  }
  if (flag('--json')) {
    console.log(JSON.stringify(reports, null, 2));
  } else {
    for (const r of reports) console.log(formatEntityReport(r, { quiet: flag('--quiet') }));
    const errs = reports.reduce((s, r) => s + r.errors, 0);
    const warns = reports.reduce((s, r) => s + r.warnings, 0);
    const passed = reports.filter(r => r.pass && (!flag('--strict') || r.warnings === 0)).length;
    console.log(`\n${reports.length} entities audited: ${passed} clean, ${reports.length - passed} flagged · ${errs} errors, ${warns} warnings`);
  }
  return reports.some(r => !r.pass || (flag('--strict') && r.warnings > 0)) ? 1 : 0;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  process.exit(runAuditCli(process.argv.slice(2)));
}
