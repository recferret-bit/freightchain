import { ROUTE_CURVATURE } from '../../../shared/route-curvature.js';
import { roadMaterial } from '../_shared/road-texture.js';

/* Almost ruler-straight with very long lazy bends – this is the Desert Bus route: the challenge is the wind drift, not the curves. */
export const curv = ROUTE_CURVATURE.stuart;
export const createRoadMaterial = () => roadMaterial({ shoulder: '#a8502c', asphalt: '#3b3a38', speck: 46, edge: '#f0f0e8', centre: { color: '#f4f4ee', style: 'dash' }, shoulderSpeck: '120,50,25' });
