import { basic } from '../_shared/mats.js';
import { spruce, birch, drift, rock } from '../_shared/props-basic.js';

/* Dense snowy forest: spruce, birch, drifts and boulders. */
export function createProps() {
  const trunk = basic(0x4a3a2c), fir = basic(0x24432e), snow = basic(0xf2f6f8), bark = basic(0xeeeeea), mark = basic(0x222222), mound = basic(0xeaf0f4), stone = basic(0x7b7f84), stone2 = basic(0x62666b);
  return {
    slots: 6, density: 0.85, near: 7, span: 55,
    pick(r, r2) { if (r < 0.5) return spruce(5 + r2 * 5, trunk, fir, snow); if (r < 0.75) return birch(5 + r2 * 3, bark, mark); if (r < 0.9) return drift(1 + r2 * 1.2, mound); return rock(0.6 + r2 * 1.4, r2, stone, stone2); },
  };
}
