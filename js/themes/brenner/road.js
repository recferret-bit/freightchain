import { ramp } from '../_shared/profile.js';
import { roadMaterial } from '../_shared/road-texture.js';

/* Mountain serpentines: tight, frequent bends – the hardest route to keep on the road. */
export const curv = s => ramp(s) * (0.0055 * Math.sin(s / 230) + 0.0035 * Math.sin(s / 95 + 0.6) + 0.0018 * Math.sin(s / 40 + 2));
export const createRoadMaterial = () => roadMaterial({ shoulder: '#6f8f4e', asphalt: '#3a3b3d', speck: 50, edge: '#f4f4f0', centre: { color: '#f4f4f0', style: 'dash' }, shoulderSpeck: '40,80,30' });
