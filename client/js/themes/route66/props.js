import { basic } from '../_shared/mats.js';
import { prop } from '../../world/entity-build.js';

/* Saguaro cacti, desert rocks, dry brush. pick(r, r2): r chooses the kind, r2 the size/variant (both 0..1, deterministic per slot). */
export function createProps() {
  const green = basic(0x4c7a3b), rock1 = basic(0x8a6c54), rock2 = basic(0x6f5a4a), brush = basic(0x7d7a3d);
  return {
    slots: 6, density: 0.55, near: 9, span: 90,
    pick(r, r2) { if (r < 0.5) return prop('cactus', { h: 2 + r2 * 3.2, r2 }, { m: green }); if (r < 0.82) return prop('rock', { s: 0.6 + r2 * 2.2, r2 }, { m1: rock1, m2: rock2 }); return prop('bush', { s: 0.5 + r2 }, { m: brush }); },
  };
}
