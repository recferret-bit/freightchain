import { createRing } from '../_shared/mountains.js';

/* Tan desert buttes. */
export const createMountains = () => createRing({ count: 26, peak: i => ({ r: 140 + ((i * 37) % 160), h: 70 + ((i * 53) % 110), dist: 1000 + (i % 3) * 120, color: 0x9c7457, segs: 5 }) });
