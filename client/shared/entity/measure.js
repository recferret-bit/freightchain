/* Analytic measurements of a part list (plan.js toParts): world-space boxes without three.js or WebGL, so the server, the MCP tools and
   the validator see what the game builds. Every mesh is its geometry's local bounds → scale → Euler rotation → position, then each parent group's transform. */

const UNIT = {   // local bounds of each GEO entry at scale 1 (client/js/world/props.js)
  box: [-.5, -.5, -.5, .5, .5, .5], cyl: [-1, -.5, -1, 1, .5, 1], cone: [-1, -.5, -1, 1, .5, 1], rock: [-1, -1, -1, 1, 1, 1],
  pyr: [-.5, -.5, -.5, .5, .5, .5], wheel20: [-1, -.5, -1, 1, .5, 1], wheel48: [-1, -.5, -1, 1, .5, 1], barrel: [-1, -.5, -1, 1, .5, 0],
};

function rotMatrix([x, y, z], order = 'XYZ') {   // three.js Euler → 3×3 (row-major)
  const a = Math.cos(x), b = Math.sin(x), c = Math.cos(y), d = Math.sin(y), e = Math.cos(z), f = Math.sin(z);
  const X = [1, 0, 0, 0, a, -b, 0, b, a], Y = [c, 0, d, 0, 1, 0, -d, 0, c], Z = [e, -f, 0, f, e, 0, 0, 0, 1];
  const M = { X, Y, Z }, mul = (p, q) => { const r = new Array(9); for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) r[i * 3 + j] = p[i * 3] * q[j] + p[i * 3 + 1] * q[3 + j] + p[i * 3 + 2] * q[6 + j]; return r; };
  return mul(mul(M[order[0]], M[order[1]]), M[order[2]]);
}
const apply = (m, [x, y, z]) => [m[0] * x + m[1] * y + m[2] * z, m[3] * x + m[4] * y + m[5] * z, m[6] * x + m[7] * y + m[8] * z];

/* parts → [{ i, part, box: [minX, minY, minZ, maxX, maxY, maxZ] }] for meshes (and glows as points) */
export function boxes(parts) {
  const xf = parts.map(() => null);   // per group: a function local point → world point
  const world = i => (i < 0 ? p => p : xf[i]);
  const out = [];
  parts.forEach((p, i) => {
    const up = world(p.parent);
    if (p.t === 'group') { const R = p.r ? rotMatrix(p.r, p.order ?? 'XYZ') : null, T = p.p; xf[i] = q => { const r = R ? apply(R, q) : q; return up([r[0] + T[0], r[1] + T[1], r[2] + T[2]]); }; return; }
    if (p.t === 'mesh') {
      const u = UNIT[p.geo], R = p.r ? rotMatrix(p.r, p.order ?? 'XYZ') : null, b = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
      for (const cx of [u[0], u[3]]) for (const cy of [u[1], u[4]]) for (const cz of [u[2], u[5]]) {
        let q = [cx * p.s[0], cy * p.s[1], cz * p.s[2]]; if (R) q = apply(R, q);
        const w = up([q[0] + p.p[0], q[1] + p.p[1], q[2] + p.p[2]]);
        for (let k = 0; k < 3; k++) { b[k] = Math.min(b[k], w[k]); b[k + 3] = Math.max(b[k + 3], w[k]); }
      }
      out.push({ i, part: p, box: b });
    }
  });
  return out;
}
export const union = bs => bs.reduce((a, { box: b }) => [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.min(a[2], b[2]), Math.max(a[3], b[3]), Math.max(a[4], b[4]), Math.max(a[5], b[5])], [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity]);
const touch = (a, b, eps) => a[0] <= b[3] + eps && b[0] <= a[3] + eps && a[1] <= b[4] + eps && b[1] <= a[4] + eps && a[2] <= b[5] + eps && b[2] <= a[5] + eps;

/* Summary for a part list: bounds, counts, and the parts that touch nothing and do not stand on the ground (floating). */
export function measure(parts, { eps = .03 } = {}) {
  const bs = boxes(parts), bounds = union(bs);
  const tags = Object.create(null); for (const { part } of bs) if (part.tag) tags[part.tag] = (tags[part.tag] ?? 0) + 1;
  const floating = [];
  for (const a of bs) {
    if (a.box[1] <= eps) continue;   // on the ground
    if (!bs.some(b => b !== a && touch(a.box, b.box, eps))) floating.push(a.i);
  }
  const nums = []; for (const p of parts) for (const v of [...(p.s ?? []), ...(p.p ?? []), ...(p.r ?? []), p.size, p.gain, p.w, p.l, p.z0, p.color]) if (v !== undefined && v !== null) nums.push(v);
  return { meshes: bs.length, glows: parts.filter(p => p.t === 'glow').length, bounds: bounds.map(v => Math.round(v * 1000) / 1000), size: [bounds[3] - bounds[0], bounds[4] - bounds[1], bounds[5] - bounds[2]].map(v => Math.round(v * 1000) / 1000), tags, floating, finite: nums.every(Number.isFinite), roles: parts.filter(p => p.role).map(p => p.role) };
}
