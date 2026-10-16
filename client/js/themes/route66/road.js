import { ROUTE_CURVATURE } from '../../../shared/route-curvature.js';
import { roadMaterial } from '../_shared/road-texture.js';

/* Gentle, long bends – the classic Mother Road. */
export const curv = ROUTE_CURVATURE.route66;
export const createRoadMaterial = () => roadMaterial({ shoulder: '#9d8860', asphalt: '#34322f', edge: '#e8e4d6', centre: { color: '#e9b920', style: 'dash' } });
