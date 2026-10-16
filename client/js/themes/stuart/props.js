import { basic } from '../_shared/mats.js';
import { prop } from '../../world/entity-build.js';

/* Ghost gums, termite mounds, spinifex, red rocks. Sparse: it is a big empty country. */
export function createProps() {
  const trunk = basic(0xe6e2d3), leaf = basic(0x8aa05a), mound = basic(0xa5502d), grass = basic(0xb7aa4f), rk1 = basic(0x9b4b2c), rk2 = basic(0x7d3a22);
  return {
    slots: 6, density: 0.45, near: 10, span: 80,
    pick(r, r2) { if (r < 0.35) return prop('gum-tree', { h: 5 + r2 * 4 }, { trunk, leaf }); if (r < 0.55) return prop('termite', { h: 1.2 + r2 * 2.2 }, { m: mound }); if (r < 0.85) return prop('tuft', { s: 0.8 + r2 * 0.9 }, { m: grass }); return prop('rock', { s: 0.5 + r2 * 1.6, r2 }, { m1: rk1, m2: rk2 }); },
  };
}
