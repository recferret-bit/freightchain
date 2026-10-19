import { basic } from '../_shared/mats.js';
import { prop } from '../../world/entity-build.js';

/* Dense snowy forest: spruce, birch, drifts and boulders. */
export function createProps() {
  const trunk = basic(0x4a3a2c), fir = basic(0x24432e), snow = basic(0xf2f6f8), bark = basic(0xeeeeea), mark = basic(0x222222), mound = basic(0xeaf0f4), stone = basic(0x7b7f84), stone2 = basic(0x62666b);
  return {
    slots: 6, density: 0.85, near: 7, span: 55,
    pick(r, r2) { if (r < 0.5) return prop('spruce', { h: 5 + r2 * 5 }, { trunk, leaf: fir, snow }); if (r < 0.75) return prop('birch', { h: 5 + r2 * 3 }, { trunk: bark, mark }); if (r < 0.9) return prop('drift', { s: 1 + r2 * 1.2 }, { m: mound }); return prop('rock', { s: 0.6 + r2 * 1.4, r2 }, { m1: stone, m2: stone2 }); },
  };
}
