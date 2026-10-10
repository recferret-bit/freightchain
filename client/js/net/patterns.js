/* Road PATTERNS: the building blocks the network (net/network.js) strings together, one after another, forever.
   A pattern is a kind of road; it lasts `len` m and is cut into lane-layout stretches of `seg` m.
   lanes: [right (own direction), left (oncoming), weight] – lane counts per direction; a change between stretches is a TAPER m transition.
   bends: × the route's own curvature (themes/<route>/road.js `curv`), so a highway bends less than a country road in the same landscape.
   centre: centre-line style ('double' = two solid lines; null = the route's own style, e.g. dashed).
   junction: { gap: m between junctions, cross: P(crossroads) else a T, signal: P(traffic lights), side: lanes per direction on the side road (picked uniformly) }.
   Weights per route: `roads: { weights: { country, highway, arterial, town } }` in themes/<route>/index.js (missing = DEFAULT_WEIGHTS); a TRIP can replace
   them (trips.js `road.weights`, and `road.first` = the patterns it starts with) – 'dual' and 'fork' have weight 0 everywhere else, so the layout of the
   old trips (and the random stream that draws it) is unchanged. Keys are walked in this order: append new patterns, never insert. */
/* A FORK: the road splits into two roads that meet again FORK_LEN m on – mirror images of each other about the straight line (the chord) between the
   split and the merge, so both are exactly as long and have the same lanes: in road coordinates (s along it, d across – everything the server judges in)
   the two roads are ONE road, and the server needs no word of which one the driver took (server/src/domain/road: the fork's corridor in onRoad only).
   heading on the default road = side · BULGE · g(u), u = (s − f0) / FORK_LEN, g(u) = sin 2πu · sin² πu (closes exactly: g(1 − u) = −g(u)) → the two
   roads are ≈ 207 m apart at the middle, ≈ 14 m apart COMMIT m after the split (CORRIDOR keeps a metre in hand). Crossing f0 + COMMIT the truck is on the road it is nearer to
   (net/orchestrator.js), its (s, d) re-measured on that road. CORRIDOR: before COMMIT (and the last COMMIT m before the merge) the tarmac of both roads
   is one apron – the server counts ±CORRIDOR m beyond the edges as road there (its bound for the gap between the roads at COMMIT). */
export const FORK_LEN = 1200, FORK = { len: FORK_LEN, bulge: .55, commit: 205, corridor: 15, reach: 1.5 };
/* reach: the frame the truck crosses the commit point is sampled (telemetry) BEFORE orchestrator.forkCommit moves it onto the road it took – so the apron
   counts as road `reach` m past the commit point in onRoad (≥ one frame at the governor: 28 m/s × 0.05 s; server road-rules.ts FORK_SWITCH_REACH) */
export const PATTERNS = {
  country:  { name: 'COUNTRY ROAD', lanes: [[1, 1, 1]], seg: [700, 1600], len: [900, 2400], bends: 1, centre: null, junction: { gap: [420, 950], cross: .5, signal: .35, side: [1, 1, 2] } },
  highway:  { name: 'HIGHWAY', lanes: [[2, 2, 3], [3, 3, 1], [3, 2, 1], [2, 3, 1]], seg: [500, 1100], len: [1600, 3600], bends: .55, centre: 'double', junction: null },
  arterial: { name: 'ARTERIAL', lanes: [[2, 2, 3], [2, 1, 1], [1, 2, 1], [3, 3, 1]], seg: [400, 900], len: [800, 1700], bends: .35, centre: 'double', junction: { gap: [260, 520], cross: .85, signal: .9, side: [1, 2] } },
  town:     { name: 'TOWN', lanes: [[1, 1, 2], [2, 2, 1]], seg: [300, 700], len: [500, 1100], bends: .15, centre: null, junction: { gap: [170, 320], cross: .7, signal: .75, side: [1] } },
  dual:     { name: 'DUAL ROAD', lanes: [[2, 2, 1]], seg: [700, 1500], len: [1500, 3200], bends: .6, centre: 'double', junction: null },   // the easy free run: four lanes, no junctions
  fork:     { name: 'COUNTRY ROAD', lanes: [[1, 1, 1]], seg: [FORK_LEN, FORK_LEN], len: [FORK_LEN, FORK_LEN], bends: 0, centre: null, junction: null, fork: true },   // the road splits in two and meets again (FORK below)
};
export const DEFAULT_WEIGHTS = { country: 3, highway: 1, arterial: 1, town: 1 };
