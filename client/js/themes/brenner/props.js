import { basic } from '../_shared/mats.js';
import { prop } from '../../world/entity-build.js';

/* Spruce forest, broadleaf trees, grey boulders and shrubs. */
export function createProps() {
  const trunk = basic(0x5a4630), fir = basic(0x2f6b3a), leaf = basic(0x4f8a3c), rk1 = basic(0x8a8d90), rk2 = basic(0x6d7074), shrub = basic(0x6b8e3a);
  return {
    slots: 6, density: 0.72, near: 9, span: 50,
    pick(r, r2) { if (r < 0.45) return prop('spruce', { h: 6 + r2 * 6 }, { trunk, leaf: fir }); if (r < 0.6) return prop('round-tree', { h: 5 + r2 * 3 }, { trunk, leaf }); if (r < 0.8) return prop('rock', { s: 0.6 + r2 * 1.8, r2 }, { m1: rk1, m2: rk2 }); return prop('bush', { s: 0.6 + r2 * 0.8 }, { m: shrub }); },
  };
}
