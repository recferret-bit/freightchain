import { ramp } from '../_shared/profile.js';
import { roadMaterial } from '../_shared/road-texture.js';

/* Gentle, long bends – the classic Mother Road. */
export const curv = s => ramp(s) * (0.0045 * Math.sin(s / 310) + 0.0035 * Math.sin(s / 130 + 1.1) + 0.0016 * Math.sin(s / 47 + 2.0));
export const createRoadMaterial = () => roadMaterial({ shoulder: '#9d8860', asphalt: '#34322f', edge: '#e8e4d6', centre: { color: '#e9b920', style: 'dash' } });
