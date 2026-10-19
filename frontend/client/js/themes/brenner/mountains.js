import { createRings } from '../_shared/mountains.js';

/* Tall snow-capped Alps behind layered forested ridges (far → near: haze, rock, slate, forest). */
export const createMountains = () => createRings([
  { ridge: { dist: 1280, h: 360, vary: 0.65, color: 0x8794a6, cap: 0xf4f7fb, capFrac: 0.4, seed: 11 } },
  { count: 18, peak: i => ({ r: 210 + ((i * 37) % 140), h: 280 + ((i * 53) % 200), dist: 1000 + ((i * 41) % 160), color: 0x6b7480, cap: 0xf4f7fb, capFrac: 0.5, segs: 7, lv: 5 }) },
  { ridge: { dist: 880, h: 170, vary: 0.6, color: 0x55705f, seed: 23 } },
  { count: 22, peak: i => ({ r: 120 + ((i * 31) % 80), h: 70 + ((i * 19) % 60), dist: 650 + ((i * 23) % 90), color: 0x3d6b3f, segs: 6 }) },
  { ridge: { dist: 520, h: 48, vary: 0.7, color: 0x2c5230, seed: 37 } },
]);
