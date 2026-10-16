import { ROUTE_CURVATURE } from '../../../shared/route-curvature.js';
import { roadMaterial } from '../_shared/road-texture.js';

/* Rolling forest road: medium bends of mixed length. */
export const curv = ROUTE_CURVATURE.siberia;
export const createRoadMaterial = () => roadMaterial({ shoulder: '#dfe6ea', asphalt: '#2c2f32', speck: 46, edge: '#e6e6e0', centre: { color: '#f2f2ee', style: 'dash' }, shoulderSpeck: '170,185,200' });
