import { createSkyDome } from '../_shared/sky-dome.js';

/* Alpine sun: clean, bright, slightly cool white. */
const sun = { dir: [0.5, 0.42, -0.75], color: [1, 0.95, 0.82], glow: 34, size: 700, gain: 3 };
const HORIZON = [0.74, 0.85, 0.95];
export const createSky = () => createSkyDome({ horizon: HORIZON, zenith: [0.1, 0.33, 0.78], sun, clouds: { amount: 0.3, color: [1, 1, 1], scale: 2.4 } });
