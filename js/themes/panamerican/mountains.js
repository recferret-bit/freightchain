import { createRings } from '../_shared/mountains.js';

/* Snow-capped volcanoes over low rust-coloured hills. */
export const createMountains = () => createRings([
  { count: 8, peak: i => ({ r: 300 + ((i * 47) % 100), h: 330 + ((i * 61) % 100), dist: 1000 + ((i * 37) % 120), color: 0x8a6050, cap: 0xf6f4f2, capFrac: 0.32, segs: 8 }) },
  { count: 22, peak: i => ({ r: 140 + ((i * 29) % 80), h: 60 + ((i * 23) % 50), dist: 850 + ((i * 31) % 150), color: 0xa8806a, segs: 6 }) },
]);
