import { ROUTE_CURVATURE } from '../../../shared/route-curvature.js';
import { roadMaterial } from '../_shared/road-texture.js';

/* Long straights joined by big sweeping bends. */
export const curv = ROUTE_CURVATURE.panamerican;
export const createRoadMaterial = () => roadMaterial({ shoulder: '#b8aa94', asphalt: '#3d3b3a', speck: 50, edge: null, centre: { color: '#e9b920', style: 'dash' }, shoulderSpeck: '110,90,70' });
