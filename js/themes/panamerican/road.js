import { ramp } from '../_shared/profile.js';
import { roadMaterial } from '../_shared/road-texture.js';

/* Long straights joined by big sweeping bends. */
export const curv = s => ramp(s) * (0.0035 * Math.sin(s / 900) + 0.0015 * Math.sin(s / 300 + 1));
export const createRoadMaterial = () => roadMaterial({ shoulder: '#b8aa94', asphalt: '#3d3b3a', speck: 50, edge: null, centre: { color: '#e9b920', style: 'dash' }, shoulderSpeck: '110,90,70' });
