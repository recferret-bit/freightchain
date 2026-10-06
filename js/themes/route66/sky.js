import { createSkyDome } from '../_shared/sky-dome.js';

/* Route 66 – high desert sun: warm white, medium halo. */
const sun = { dir: [0.35, 0.28, -0.9], color: [1, 0.85, 0.55], glow: 40, size: 900, gain: 3 };
const HORIZON = [0.90, 0.79, 0.63];   // = fog colour
export const createSky = () => createSkyDome({ horizon: HORIZON, zenith: [0.22, 0.46, 0.80], sun, clouds: { amount: 0.1, color: [1, 0.97, 0.92], scale: 2.2 } });
