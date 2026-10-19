import { createRings } from '../_shared/mountains.js';

/* Snow-capped volcanoes over layered rust-coloured hills. */
export const createMountains = () => createRings([
  { ridge: { dist: 1250, h: 230, vary: 0.6, color: 0xa08272, seed: 5 } },
  { count: 8, peak: i => ({ r: 300 + ((i * 47) % 100), h: 330 + ((i * 61) % 100), dist: 1000 + ((i * 37) % 120), color: 0x8a6050, cap: 0xf6f4f2, capFrac: 0.32, segs: 8, lv: 5 }) },
  { ridge: { dist: 820, h: 110, vary: 0.6, color: 0x93705c, seed: 17 } },
  { count: 20, peak: i => ({ r: 140 + ((i * 29) % 80), h: 60 + ((i * 23) % 50), dist: 640 + ((i * 31) % 120), color: 0xa8806a, segs: 6 }) },
  { ridge: { dist: 500, h: 40, vary: 0.7, color: 0x7a5844, seed: 29 } },
]);
