import { ramp } from '../_shared/profile.js';
import { roadMaterial } from '../_shared/road-texture.js';

/* Rolling forest road: medium bends of mixed length. */
export const curv = s => ramp(s) * (0.0030 * Math.sin(s / 420) + 0.0025 * Math.sin(s / 170 + 2) + 0.0010 * Math.sin(s / 60));
export const createRoadMaterial = () => roadMaterial({ shoulder: '#dfe6ea', asphalt: '#2c2f32', speck: 46, edge: '#e6e6e0', centre: { color: '#f2f2ee', style: 'dash' }, shoulderSpeck: '170,185,200' });
