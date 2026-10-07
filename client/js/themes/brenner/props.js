import { basic } from '../_shared/mats.js';
import { spruce, roundTree, rock, bush } from '../_shared/props-basic.js';

/* Spruce forest, broadleaf trees, grey boulders and shrubs. */
export function createProps() {
  const trunk = basic(0x5a4630), fir = basic(0x2f6b3a), leaf = basic(0x4f8a3c), rk1 = basic(0x8a8d90), rk2 = basic(0x6d7074), shrub = basic(0x6b8e3a);
  return {
    slots: 6, density: 0.72, near: 9, span: 50,
    pick(r, r2) { if (r < 0.45) return spruce(6 + r2 * 6, trunk, fir); if (r < 0.6) return roundTree(5 + r2 * 3, trunk, leaf); if (r < 0.8) return rock(0.6 + r2 * 1.8, r2, rk1, rk2); return bush(0.6 + r2 * 0.8, shrub); },
  };
}
