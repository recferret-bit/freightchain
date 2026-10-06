/* Road PATTERNS: the building blocks the network (net/network.js) strings together, one after another, forever.
   A pattern is a kind of road; it lasts `len` m and is cut into lane-layout stretches of `seg` m.
   lanes: [right (own direction), left (oncoming), weight] – lane counts per direction; a change between stretches is a TAPER m transition.
   bends: × the route's own curvature (themes/<route>/road.js `curv`), so a highway bends less than a country road in the same landscape.
   centre: centre-line style ('double' = two solid lines; null = the route's own style, e.g. dashed).
   junction: { gap: m between junctions, cross: P(crossroads) else a T, signal: P(traffic lights), side: lanes per direction on the side road (picked uniformly) }.
   Weights per route: `roads: { weights: { country, highway, arterial, town } }` in themes/<route>/index.js (missing = DEFAULT_WEIGHTS). */
export const PATTERNS = {
  country:  { name: 'COUNTRY ROAD', lanes: [[1, 1, 1]], seg: [700, 1600], len: [900, 2400], bends: 1, centre: null, junction: { gap: [420, 950], cross: .5, signal: .35, side: [1, 1, 2] } },
  highway:  { name: 'HIGHWAY', lanes: [[2, 2, 3], [3, 3, 1], [3, 2, 1], [2, 3, 1]], seg: [500, 1100], len: [1600, 3600], bends: .55, centre: 'double', junction: null },
  arterial: { name: 'ARTERIAL', lanes: [[2, 2, 3], [2, 1, 1], [1, 2, 1], [3, 3, 1]], seg: [400, 900], len: [800, 1700], bends: .35, centre: 'double', junction: { gap: [260, 520], cross: .85, signal: .9, side: [1, 2] } },
  town:     { name: 'TOWN', lanes: [[1, 1, 2], [2, 2, 1]], seg: [300, 700], len: [500, 1100], bends: .15, centre: null, junction: { gap: [170, 320], cross: .7, signal: .75, side: [1] } },
};
export const DEFAULT_WEIGHTS = { country: 3, highway: 1, arterial: 1, town: 1 };
