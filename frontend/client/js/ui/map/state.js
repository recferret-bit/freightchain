import { st, dn } from '../../state.js';
import { CFG } from '../../config.js';
import { roadAt } from '../../road.js';
import { net } from '../../net/network.js';
import { PATTERNS } from '../../net/patterns.js';
import { env } from '../../world/environment.js';
import { destroyed } from '../../world/props.js';

/* Shared phone map state, palette, road queries, and landmark discovery. */

export const LAND = { route66: '#f1e7d3', stuart: '#f2e1cf', siberia: '#eef2f5', brenner: '#e4efdc', panamerican: '#f3ede3' };
export const ZOOMS = [.6, 1.2, 2.4, 4.8, 9.6, 19.2];   // metres per CSS pixel of the big map
export const MAX_R = 4000, GROW = 1500;   // the big map draws at most 4 km around the truck, and reaches ≤ 1.5 km further per frame
export const CH = CFG.CHUNK_LEN;
export const SB = 38;   // status bar height in the 300 × 600 layout
export const THUMB = { thumb: true, mpp: 5 };
export const POI = {
  motel: { col: '#8e44ad', kind: 'bed', name: 'MOTEL' },
  hotel: { col: '#8e44ad', kind: 'bed', name: 'HOTEL' },
  gas: { col: '#e8710a', kind: 'pump', name: 'GAS STATION' },
  gulp: { col: '#f5c400', kind: 'pump', name: 'GULP' },
  police: { col: '#3949ab', kind: 'badge', name: 'POLICE' },
  restaurant: { col: '#d84315', kind: 'fork', name: 'FOOD' },
};

export const view = {
  sites: new Map(), off: false, bounce: null, z: 2, northUp: false, rot: null,
  vAvg: 10, last: 0, reach: 0, wheel: 0, k: 1, hits: [], pois: [],
  free: null, touched: 0, drag: null, sel: null, el: null, cv: null, raf: 0,
};

export function resetMapView() {
  Object.assign(view, { sites: new Map(), off: false, rot: null, vAvg: 10, last: 0, reach: 0, wheel: 0, free: null, drag: null, sel: null });
}

export function palette() {
  return dn.k > .5
    ? { land: '#161d29', block: '#1f2937', road: '#7686a0', casing: '#080b11', label: '#e6ebf2', route: '#7db8ff', routeCase: '#1d56b5', alt: '#8c98ab', altCase: '#3d4756', text: '#f3f6fa', card: '#222b39', sub: '#aab5c5', nav: '#13804d', pin: '#ff6b5a', go: '#5ee08f', bar: 'rgba(255,255,255,.14)', bar0: 'rgba(14,19,28,.94)' }
    : { land: LAND[env.theme?.id] ?? '#f1efe8', block: '#e2ddd2', road: '#ffffff', casing: '#c8c1b2', label: '#5f6368', route: '#4285f4', routeCase: '#1a5fd0', alt: '#aab3bf', altCase: '#86909d', text: '#202124', card: '#ffffff', sub: '#5f6368', nav: '#0b8043', pin: '#ea4335', go: '#188038', bar: 'rgba(0,0,0,.1)', bar0: 'rgba(255,255,255,.94)' };
}

/* where the truck is, in the world (roadAt + st.d across) and where it points */
export function truck() { const p = roadAt(st.s); return { x: p.x + Math.cos(p.t) * st.d, z: p.z + Math.sin(p.t) * st.d, h: p.t + st.psi }; }
/** the finish of the shift on the road (s), or null once it is complete: always the fixed distance COMPLETE_DIST (server-set online). */
export const target = () => (st.complete ? null : Math.max(CFG.COMPLETE_DIST, 0));
export const roadName = s => { if (s < net.Sm) return 'DEPOT ROAD'; const x = net.mainXs(s); return PATTERNS[x.pat]?.name ?? 'ROAD'; };

/** the landmarks between s0 and s1 along the road, as the world builds them (cached per chunk in view.sites, filtered against destroyed). */
export function places(s0, s1) {
  const out = []; if (!env.landmarks) return out;
  for (let ci = Math.max(1, Math.floor(s0 / CH)); ci <= Math.floor(s1 / CH); ci++) {
    let q = view.sites.get(ci);
    if (q === undefined) {
      q = null; const L = (env.landmarks.nearStart !== ci && net.busy(ci * CH - 20, ci * CH + CH + 20)) ? null : env.landmarks.site(ci, ci * CH);
      if (L) { const lat = net.roadside(L.s, L.lat); if (!net.keepOut(L.s, lat)) { const w = net.world(L.s, lat); q = { id: ci, type: L.type, impl: L.v.id, hl: L.hl, name: L.name, s: L.s, side: L.side, x: w.x, z: w.z }; } }
      view.sites.set(ci, q);
    }
    if (q && !destroyed.has(ci + ':lm') && !destroyed.has('b:' + ci + ':lm')) out.push(q);
  }
  return out;
}
