import { basic } from '../_shared/mats.js';
import { cactus, rock, bush } from '../_shared/props-basic.js';

/* Saguaro cacti, desert rocks, dry brush. pick(r, r2): r chooses the kind, r2 the size/variant (both 0..1, deterministic per slot). */
export function createProps() {
  const green = basic(0x4c7a3b), rock1 = basic(0x8a6c54), rock2 = basic(0x6f5a4a), brush = basic(0x7d7a3d);
  return {
    slots: 6, density: 0.55, near: 9, span: 90,
    pick(r, r2) { if (r < 0.5) return cactus(2 + r2 * 3.2, r2, green); if (r < 0.82) return rock(0.6 + r2 * 2.2, r2, rock1, rock2); return bush(0.5 + r2, brush); },
  };
}
