import { createRings } from '../_shared/mountains.js';

/* Tall snow-capped Alps behind forested foothills. */
export const createMountains = () => createRings([
  { count: 20, peak: i => ({ r: 210 + ((i * 37) % 140), h: 280 + ((i * 53) % 200), dist: 950 + ((i * 41) % 200), color: 0x6b7480, cap: 0xf4f7fb, capFrac: 0.5, segs: 6 }) },
  { count: 24, peak: i => ({ r: 120 + ((i * 31) % 80), h: 70 + ((i * 19) % 60), dist: 800 + ((i * 23) % 100), color: 0x3d6b3f, segs: 6 }) },
]);
