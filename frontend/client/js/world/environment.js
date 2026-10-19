import * as THREE from 'three';
import { scene } from './scene.js';
import { disposeMats } from '../themes/_shared/mats.js';

/* The currently applied route's scenery: sky dome, terrain, mountains, road material, prop picker and roadside furniture.
   `env` is read by chunks.js (road + props), render.js (follows the camera) and the windscreen (dust colour). Switch routes with world/theme-manager.js. */
export const env = { theme: null, sky: null, terrain: null, mountains: null, roadMat: null, props: null, furniture: null, landmarks: null };

function removeFromScene(o) { if (!o) return; scene.remove(o); o.traverse?.(c => c.geometry?.dispose?.()); }
export function applyTheme(theme) {
  for (const o of [env.sky?.mesh, env.terrain?.mesh, env.mountains]) removeFromScene(o);
  disposeMats();   // all theme materials are rebuilt below
  env.theme = theme;
  env.sky = theme.createSky(); env.terrain = theme.createTerrain(); env.mountains = theme.createMountains();   // (order matters only for the deterministic headless trace)
  env.roadMat = theme.createRoadMaterial(); env.props = theme.createProps(); env.furniture = theme.createFurniture(); env.landmarks = theme.createLandmarks?.() ?? null;
  scene.add(env.sky.mesh, env.terrain.mesh, env.mountains);
  scene.fog = new THREE.Fog(theme.fog.color, theme.fog.near, theme.fog.far);
}
