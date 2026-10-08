import { GEO, mk } from '../../world/props.js';
import { group } from '../../world/pool.js';

/* Shape builders shared by the routes. Each takes the theme's own materials and returns a Group whose userData describes it to the collision system:
   { kind (key of KINDS in world/props.js), size (passed to that kind's table), debris (material, or [materials] picked at random, for the smash particles) }.
   Models are origin-on-the-ground, y up. */
const grp = (kind, size, debris, name = kind) => { const g = group(); g.name = name; g.userData = { kind, size, debris }; return g; };   // name = label in the model viewer

export function cactus(h, r2, m) {   // saguaro: trunk + up to two arms
  const g = grp('cactus', h, m);
  g.add(mk(GEO.cyl, m, 0.32, h, 0.32, 0, h / 2, 0));
  if (r2 > 0.3) { g.add(mk(GEO.box, m, 0.7, 0.2, 0.2, 0.5, h * 0.45, 0)); g.add(mk(GEO.cyl, m, 0.2, h * 0.35, 0.2, 0.8, h * 0.45 + h * 0.17, 0)); }
  if (r2 > 0.65) { g.add(mk(GEO.box, m, 0.6, 0.2, 0.2, -0.45, h * 0.62, 0)); g.add(mk(GEO.cyl, m, 0.2, h * 0.3, 0.2, -0.7, h * 0.62 + h * 0.14, 0)); }
  return g;
}
export function rock(s, r2, m1, m2 = m1) {
  const g = grp('rock', s, [m1, m2]), q = mk(GEO.rock, r2 > 0.5 ? m1 : m2, s * 1.3, s * 0.8, s, 0, s * 0.35, 0); q.rotation.y = r2 * 6; g.add(q); return g;
}
export function bush(s, m) { const g = grp('bush', s, m); g.add(mk(GEO.cone, m, s, s * 0.9, s, 0, s * 0.45, 0)); return g; }
export function tuft(s, m) {   // grass clump: three leaning blades (spinifex / paja brava)
  const g = grp('bush', s, m, 'grass tuft');
  for (const [x, z, t] of [[0, 0, 0], [.35, .1, .3], [-.3, .15, -.3]]) { const c = mk(GEO.cone, m, s * .35, s * 1.2, s * .35, x * s, s * .55, z * s); c.rotation.z = t; g.add(c); }
  return g;
}
export function termite(h, m) { const g = grp('termite', h, m, 'termite mound'); g.add(mk(GEO.cone, m, h * .45, h, h * .45, 0, h / 2, 0)); g.add(mk(GEO.cone, m, h * .28, h * .7, h * .28, h * .25, h * .35, h * .1)); return g; }
export function cairn(s, m) { const g = grp('rock', s, m, 'cairn'); for (const [w, hh, y] of [[1.3, .35, 0], [1, .3, .45], [.7, .25, .78]]) g.add(mk(GEO.rock, m, s * w * .5, s * hh, s * w * .5, 0, s * y * .6, 0)); return g; }
export function drift(s, m) { const g = grp('drift', s, m, 'snow drift'); g.add(mk(GEO.rock, m, s * 1.5, s * .45, s * 1.1, 0, s * .15, 0)); return g; }
export function spruce(h, trunk, leaf, snow = null) {   // stacked cones; optional snow caps on each tier
  const g = grp('tree', h, leaf, 'spruce'); g.add(mk(GEO.cyl, trunk, .25, h * .25, .25, 0, h * .125, 0));
  for (let i = 0; i < 4; i++) { const y = h * (.2 + i * .2), w = h * (.28 - i * .05); g.add(mk(GEO.cone, leaf, w, h * .34, w, 0, y + h * .12, 0)); if (snow) g.add(mk(GEO.cone, snow, w * .8, h * .2, w * .8, 0, y + h * .2, 0)); }
  return g;
}
export function roundTree(h, trunk, leaf) {   // broadleaf: trunk + two canopy blobs
  const g = grp('tree', h, leaf, 'broadleaf tree'); g.add(mk(GEO.cyl, trunk, .3, h * .5, .3, 0, h * .25, 0));
  g.add(mk(GEO.rock, leaf, h * .32, h * .28, h * .32, 0, h * .72, 0)); g.add(mk(GEO.rock, leaf, h * .22, h * .2, h * .22, h * .12, h * .92, h * .05)); return g;
}
export function gumTree(h, trunk, leaf) {   // eucalyptus / ghost gum: pale slim trunk, wide flat canopy
  const g = grp('tree', h, leaf, 'gum tree'), t = mk(GEO.cyl, trunk, .22, h * .8, .22, 0, h * .4, 0); t.rotation.z = .08; g.add(t);
  g.add(mk(GEO.rock, leaf, h * .38, h * .13, h * .38, .2, h * .86, 0)); g.add(mk(GEO.rock, leaf, h * .26, h * .1, h * .26, -.5, h * .72, .3)); return g;
}
export function birch(h, trunk, mark) {   // winter birch: white trunk with dark marks and bare twigs
  const g = grp('tree', h, trunk, 'birch'); g.add(mk(GEO.cyl, trunk, .13, h, .13, 0, h / 2, 0));
  for (const y of [.15, .32, .5, .68]) g.add(mk(GEO.box, mark, .16, .07, .16, 0, h * y, 0));
  // The twig is a long box spun about its own centre. That centre has to sit out past the bark,
  // or the inner half of the box comes out the far side of the trunk.
  const half = h * .11, R = .13;
  for (const [y, a] of [[.7, .7], [.82, -.6], [.9, .4]]) {
    const s = Math.sin(a), b = mk(GEO.box, trunk, .05, h * .22, .05, Math.sign(s) * R + s * half, h * y, 0); b.rotation.z = -a; g.add(b);
  }
  return g;
}
