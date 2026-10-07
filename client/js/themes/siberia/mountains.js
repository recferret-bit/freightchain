import { createRings } from '../_shared/mountains.js';

/* A dark wall of taiga on the horizon (partly lost in the mist) plus pale hills behind it. */
export const createMountains = () => createRings([
  { count: 70, peak: i => ({ r: 14 + ((i * 13) % 14), h: 22 + ((i * 7) % 22), dist: 430 + ((i * 29) % 160), color: 0x1f3a2a, segs: 6, jitter: Math.sin(i * 3.1) * 0.05 }) },
  { count: 14, peak: i => ({ r: 200, h: 40 + ((i * 17) % 40), dist: 650 + ((i * 11) % 60), color: 0xdce3e9, segs: 6 }) },
]);
