import { basic } from '../_shared/mats.js';
import { prop } from '../../world/entity-build.js';

/* Paja brava tufts, pink-brown rocks, stone cairns and tall cardón cacti. Sparse. */
export function createProps() {
  const paja = basic(0xc8b25a), rk1 = basic(0xa07060), rk2 = basic(0x80584a), stone = basic(0x9a8a7a), cardon = basic(0x6f8f5a);
  return {
    slots: 6, density: 0.38, near: 10, span: 90,
    pick(r, r2) { if (r < 0.4) return prop('tuft', { s: 0.8 + r2 * 0.8 }, { m: paja }); if (r < 0.65) return prop('rock', { s: 0.6 + r2 * 1.8, r2 }, { m1: rk1, m2: rk2 }); if (r < 0.8) return prop('cairn', { s: 0.9 + r2 * 0.6 }, { m: stone }); return prop('cactus', { h: 3 + r2 * 3, r2 }, { m: cardon }); },
  };
}
