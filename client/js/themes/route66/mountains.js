import { createRings } from '../_shared/mountains.js';

/* Tan desert buttes in front of a hazy range. */
export const createMountains = () => createRings([
  { ridge: { dist: 1250, h: 190, vary: 0.65, color: 0xa88567, seed: 3 } },
  { count: 22, peak: i => ({ r: 140 + ((i * 37) % 160), h: 70 + ((i * 53) % 110), dist: 900 + (i % 3) * 120, color: 0x9c7457, segs: 6, lv: 5 }) },
  { count: 14, peak: i => ({ r: 90 + ((i * 29) % 90), h: 36 + ((i * 41) % 50), dist: 560 + (i % 3) * 70, color: 0x84603f, segs: 5, top: 0.6 }) },
]);
