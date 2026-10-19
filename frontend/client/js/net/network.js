import { CFG } from '../config.js';
import * as geometry from '../road.js';
import { trip } from '../trips.js';
import { createRoadNetwork } from '../../shared/road-network.js';
export { LW, TAPER, SHOULDER, SIDE_LEN, edgeOf, laneLat } from '../../shared/road.js';
export const net = createRoadNetwork({ config: CFG, geometry, trip });
