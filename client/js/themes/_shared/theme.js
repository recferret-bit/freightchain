import { createFurniture } from './furniture.js';
import { createLandmarks } from './landmarks/index.js';

/* Assembles a route from its folder's modules (road / sky / terrain / mountains / props) plus plain data. See AGENTS.md ("Themes") for the interface.
   meta: id, name, country, route, blurb, difficulty (1-5 curves), swatches [sky, ground, road] (menu card), fog { color, near, far } (= the sky's HORIZON), grime 'r,g,b' (windscreen dust),
         finishText (model viewer's gantry only), livery (trailer),
         weather { ambient °C by day (night is CFG.NIGHT_CHILL colder), snow 0..1 } – engine warm-up, windscreen frost, snowfall,
         daylight { rise, set (h), tw (twilight length h), peak (noon sun height 0..1), warm [r,g,b] (dusk/dawn horizon), stars 0..1 } – see world/daynight.js,
         furniture (options of _shared/furniture.js), landmarks (options of _shared/landmarks, optional: no key = no buildings). */
export function defineTheme({ furniture, landmarks, ...meta }, { road, sky, terrain, mountains, props }) {
  return {
    ...meta,
    curv: road.curv, createRoadMaterial: road.createRoadMaterial, createSky: sky.createSky, createTerrain: terrain.createTerrain, createMountains: mountains.createMountains, createProps: props.createProps,
    createFurniture: () => createFurniture(furniture),
    ...landmarks && { createLandmarks: () => createLandmarks(landmarks) },
  };
}
