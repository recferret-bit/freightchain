import { createRings } from '../_shared/mountains.js';

/* A dark wall of taiga on the horizon (partly lost in the mist) plus pale hills behind it. */
export const createMountains = () => createRings([
  { ridge: { dist: 660, h: 85, vary: 0.6, color: 0xdce3e9, cap: 0xf4f7fa, capFrac: 0.5, seed: 4 } },
  { count: 12, peak: i => ({ r: 200, h: 40 + ((i * 17) % 40), dist: 640 + ((i * 11) % 60), color: 0xdce3e9, segs: 6 }) },
  { ridge: { dist: 520, h: 40, vary: 0.7, color: 0x35503f, seed: 14 } },
  { count: 70, peak: i => ({ r: 14 + ((i * 13) % 14), h: 22 + ((i * 7) % 22), dist: 430 + ((i * 29) % 160), color: 0x1f3a2a, segs: 6, lv: 3, jitter: Math.sin(i * 3.1) * 0.05 }) },
]);
