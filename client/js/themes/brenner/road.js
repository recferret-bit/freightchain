import { ROUTE_CURVATURE } from '../../../shared/route-curvature.js';
import { roadMaterial } from '../_shared/road-texture.js';

/* Mountain serpentines: tight, frequent bends – the hardest route to keep on the road. */
export const curv = ROUTE_CURVATURE.brenner;
export const createRoadMaterial = () => roadMaterial({ shoulder: '#6f8f4e', asphalt: '#3a3b3d', speck: 50, edge: '#f4f4f0', centre: { color: '#f4f4f0', style: 'dash' }, shoulderSpeck: '40,80,30' });
