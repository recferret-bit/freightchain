import { createSkyDome } from '../_shared/sky-dome.js';

/* Overcast taiga: a low, pale, dim sun barely showing through cloud. */
const sun = { dir: [-0.3, 0.14, -0.95], color: [0.85, 0.88, 0.95], glow: 14, size: 160, gain: 0.8 };
const HORIZON = [0.81, 0.84, 0.87];
export const createSky = () => createSkyDome({ horizon: HORIZON, zenith: [0.55, 0.61, 0.69], sun, clouds: { amount: 0.8, color: [0.9, 0.92, 0.95], scale: 1.6 } });
