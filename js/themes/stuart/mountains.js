import { createRing } from '../_shared/mountains.js';

/* Low flat-topped red mesas on the far horizon. */
export const createMountains = () => createRing({ count: 16, peak: i => ({ r: 160 + ((i * 41) % 110), h: 35 + ((i * 29) % 40), dist: 900 + ((i * 53) % 200), color: 0x8b4a30, top: 0.78, segs: 8 }) });
