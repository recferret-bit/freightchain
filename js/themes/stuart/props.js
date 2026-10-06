import { basic } from '../_shared/mats.js';
import { gumTree, termite, tuft, rock } from '../_shared/props-basic.js';

/* Ghost gums, termite mounds, spinifex, red rocks. Sparse: it is a big empty country. */
export function createProps() {
  const trunk = basic(0xe6e2d3), leaf = basic(0x8aa05a), mound = basic(0xa5502d), grass = basic(0xb7aa4f), rk1 = basic(0x9b4b2c), rk2 = basic(0x7d3a22);
  return {
    slots: 6, density: 0.45, near: 10, span: 80,
    pick(r, r2) { if (r < 0.35) return gumTree(5 + r2 * 4, trunk, leaf); if (r < 0.55) return termite(1.2 + r2 * 2.2, mound); if (r < 0.85) return tuft(0.8 + r2 * 0.9, grass); return rock(0.5 + r2 * 1.6, r2, rk1, rk2); },
  };
}
