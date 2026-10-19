import { createRings } from '../_shared/mountains.js';

/* Low flat-topped red mesas on the far horizon, a hazy range behind and red scrub hills in front. */
export const createMountains = () => createRings([
  { ridge: { dist: 1250, h: 120, vary: 0.5, color: 0xa66448, seed: 9 } },
  { count: 14, peak: i => ({ r: 160 + ((i * 41) % 110), h: 35 + ((i * 29) % 40), dist: 900 + ((i * 53) % 200), color: 0x8b4a30, top: 0.78, segs: 8, lv: 5 }) },
  { ridge: { dist: 620, h: 28, vary: 0.6, color: 0x7a3f28, seed: 19 } },
]);
