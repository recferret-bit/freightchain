import { createSkyDome } from '../_shared/sky-dome.js';

/* Altiplano: thin air, a small blinding sun high in a deep-blue sky. */
const sun = { dir: [0.15, 0.6, -0.78], color: [1, 0.93, 0.75], glow: 28, size: 800, gain: 3.4 };
const HORIZON = [0.89, 0.85, 0.81];
export const createSky = () => createSkyDome({ horizon: HORIZON, zenith: [0.08, 0.27, 0.7], sun, clouds: { amount: 0.04, color: [1, 1, 1], scale: 1.2 } });
