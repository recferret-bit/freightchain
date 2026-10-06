import { createSkyDome } from '../_shared/sky-dome.js';

/* Outback: high, fierce, small white sun. */
const sun = { dir: [0.2, 0.55, -0.8], color: [1, 0.9, 0.65], glow: 30, size: 600, gain: 3.5 };
const HORIZON = [0.93, 0.83, 0.68];
export const createSky = () => createSkyDome({ horizon: HORIZON, zenith: [0.13, 0.4, 0.84], sun, clouds: { amount: 0.06, color: [1, 0.98, 0.94], scale: 1.4 } });
