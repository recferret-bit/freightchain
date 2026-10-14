/* Road PATTERNS: the building blocks the network (net/network.js) strings together, one after another, forever.
   A pattern is a kind of road; it lasts `len` m and is cut into lane-layout stretches of `seg` m.
   lanes: [right (own direction), left (oncoming), weight] – lane counts per direction; a change between stretches is a TAPER m transition.
   bends: × the route's own curvature (themes/<route>/road.js `curv`), so a highway bends less than a country road in the same landscape.
   centre: centre-line style ('double' = two solid lines; null = the route's own style, e.g. dashed).
   junction: { gap: m between junctions, cross: P(crossroads) else a T, signal: P(traffic lights), side: lanes per direction on the side road (picked uniformly) }.
   Weights per route: `roads: { weights: { country, highway, arterial, town } }` in themes/<route>/index.js (missing = DEFAULT_WEIGHTS); a TRIP can replace
   them (trips.js `road.weights`, and `road.first` = the patterns it starts with) – 'dual' and 'fork' have weight 0 everywhere else, so the layout of the
   old trips (and the random stream that draws it) is unchanged. Keys are walked in this order: append new patterns, never insert.
   'xroad' / 'xroad4' / 'open' are the free levels' building blocks (trips.js free-*b): a fixed 500 m stretch that holds EXACTLY ONE crossroads ('xroad' 1+1 lanes,
   'xroad4' 2+2) or none ('open'), so a trip's `road.first` list = an exact number of crossroads, in order. Why it is exact: the junction lands in [220, 380) m of
   the stretch (gap[0] = 380 = the room before its last 120 m; the first junction is r · gap[0], never before TAPER + 100), the next one would lie ≥ 600 m on (past
   the stretch), and the carried-over `nextJ` (< gap[0] + gap[1] = 880) still falls inside the NEXT stretch's window (220..380 + 500) – after 'open' or any pattern
   without junctions `nextJ` is reset, so a stretch never inherits a stale one. */
/* A FORK: the road splits into two roads that meet again FORK_LEN m on – mirror images of each other about the straight line (the chord) between the
   split and the merge, so both are exactly as long and have the same lanes: in road coordinates (s along it, d across – everything the server judges in)
   the two roads are ONE road, and the server needs no word of which one the driver took (server/src/domain/road: the fork's corridor in onRoad only).
   heading on the default road = side · BULGE · g(u), u = (s − f0) / FORK_LEN, g(u) = sin 2πu · sin² πu (closes exactly: g(1 − u) = −g(u)) → the two
   roads are ≈ 207 m apart at the middle, ≈ 14 m apart COMMIT m after the split (CORRIDOR keeps a metre in hand). Crossing f0 + COMMIT the truck is on the road it is nearer to
   (net/orchestrator.js), its (s, d) re-measured on that road. CORRIDOR: before COMMIT (and the last COMMIT m before the merge) the tarmac of both roads
   is one apron – the server counts ±CORRIDOR m beyond the edges as road there (its bound for the gap between the roads at COMMIT). */
export { FORK_LEN, FORK, PATTERNS, DEFAULT_WEIGHTS } from '../../shared/road.js';
