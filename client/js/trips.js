/* TRIPS – what a ride's road is LIKE, per ride tier (the lobby's free shift and the 1 h / 4 h / 8 h tickets). The truck, the inputs and the physics are
   the same on every trip; a trip only shapes the world around them. Every number is a MULTIPLIER on the CFG value it names, so '1h' (all 1) is the road
   as it was before trips existed – offline play.html, the headless trace, the e2e runs and the promo clips use it.
   Mostly CLIENT-SIDE levers: the server rebuilds the layout and the holes from the seed + the ride's trip and judges the recording against them
   (server/src/domain/road, verdict/world-checks.ts), so the two JUDGED knobs below (`holesFrom`, `road`) are mirrored there (road-rules.ts TRIP_HOLE_FIRST /
   TRIP_ROADS, road-drift.spec.ts); hole damage, off-road time and the governor are not trip knobs at all. The shift LENGTH is the server's (ride-tier.ts /
   FREE_RIDE_SECONDS, × the free level's multiple – ride-trip.ts FREE_LEVELS).
     bends    × the route's curvature (net/network.js curv) – geometry only; the judge works in road coordinates (s, d)
     traffic  × CFG.TRAFFIC_MAX vehicles on the main road, and ÷ on CFG.TRAFFIC_GAP (more cars, sooner)
     cross    × CFG.CROSS_MAX vehicles on the side roads of a signalled crossroads (0 = side roads stay empty)
     calm     only the 'cruise' / 'slow' behaviours spawn (no tailgaters, weavers, overtakers or sirens)
     props    × the route's roadside scenery density (props.js `density`) – fewer things to clip
     finish   the shift ENDS by itself, as a win, the moment it is complete (otherwise the road goes on until the driver leaves: top right, the lobby or the front page)
     start    'depot' = the depot road meets the main road at a STOP line and the truck turns right onto it (traffic both ways past the exit);
              'straight' = the depot road runs straight on into the main road: no turn, no junction, nothing behind the exit. Geometry only – the
              server's layout (sA, Sm, the start junction, holes from Sm + HOLE_FIRST) is the same, and it does not judge the start area (road-layout.ts knownFrom)
     seconds, k  the free run's shift for the GUEST run: RIDE_MIN_SECONDS and COMPLETE_DIST = k × MAX_SPEED × seconds. Online the server's ride
              sets both (FREE_RIDE_SECONDS, FREE_COMPLETE_DIST_K – server/test/unit/domain/ride-trip.spec.ts holds them together)
     holesFrom   m of main road before the first natural sinkhole (default CFG.HOLE_FIRST). JUDGED: the server's obstacle plan uses the same
              number per trip (server/src/domain/road/road-rules.ts TRIP_HOLE_FIRST, road-drift.spec.ts) – the free run never reaches a sinkhole
     road     the LAYOUT knobs – JUDGED as well, mirrored by road-rules.ts TRIP_ROADS (road-drift.spec.ts runs every trip): `first` = the patterns the road
              starts with (default ['country'] – the depot exit), `weights` = the pattern weights after them (replaces the route's; 'dual' = four lanes and
              no junctions, 'fork' = the road splits in two and meets again – net/patterns.js FORK), `holeChance` = × CFG.HOLE_CHANCE per chunk
     level, assist   the FREE levels (the lobby's EASY / CROSSROADS / HARD): which level a free trip is, and whether ASSIST may be on (the server refuses it
              otherwise – ride-trip.ts FREE_LEVELS); the shift length of a level is the server's (FREE_RIDE_SECONDS × its multiple)
   WHICH trip a ride is driven on is the SERVER's: it stamps an id on the ride when it is created (server/src/domain/rides/ride-trip.ts, `trip` in the ride
   and watch payloads) and a replay rebuilds that road. So an id is FROZEN once rides carry it: retune by adding a new id (here and in ride-trip.ts) and
   pointing the tier at it. 'classic' = the road before trips (a ride with trip null) – keep it as it is.
   Tuning: the trip-design skill (`node .claude/skills/trip-design/measure.mjs`). A new key here needs its reader and a row in that skill. */
export const TRIPS = {
  classic: { id: 'classic', name: 'CLASSIC', bends: 1, traffic: 1,   cross: 1, calm: false, props: 1,   finish: false, start: 'depot' },   // rides from before trips
  free: { id: 'free', name: 'FREE RUN',     bends: .4,  traffic: .4,  cross: 0, calm: true,  props: .5,  finish: true,  start: 'straight', seconds: 60, k: .25, holesFrom: 1200 },   // free rides from before the levels
  // the three FREE levels (2026-10): easy = four lanes, no junctions, no turn, 60 s · crossroads = junctions, the depot turn, forks, more holes, 3 min · hard = the full
  // network, sharper bends, busy traffic, the most holes, 10 min, no TUTORIAL and no ASSIST. Their seconds / k are the GUEST shift; online the server's ride sets both.
  'free-1': { id: 'free-1', name: 'FREE · EASY', level: 1, tutorial: true, assist: true, bends: .5, traffic: .4, cross: 0, calm: true, props: .5, finish: true, start: 'straight', seconds: 60, k: .25, holesFrom: 1200,
    road: { first: ['dual'], weights: { dual: 1 } } },
  'free-2': { id: 'free-2', name: 'FREE · CROSSROADS', level: 2, tutorial: true, assist: true, bends: .8, traffic: .7, cross: .7, calm: true, props: .8, finish: true, start: 'depot', seconds: 180, k: .3, holesFrom: 400,
    road: { first: ['country', 'fork'], weights: { country: 3, arterial: 1, town: 1, fork: 2 }, holeChance: 1.5 } },
  'free-3': { id: 'free-3', name: 'FREE · HARD', level: 3, tutorial: false, assist: false, bends: 1.3, traffic: 1.4, cross: 1.4, calm: false, props: 1.2, finish: true, start: 'depot', seconds: 600, k: .4,
    road: { first: ['country', 'fork'], weights: { country: 3, highway: 1, arterial: 1.5, town: 1.5, fork: 1.5 }, holeChance: 2 } },
  '1h': { id: '1h',   name: '1 HOUR HAUL',  bends: 1,   traffic: 1,   cross: 1, calm: false, props: 1,   finish: false, start: 'depot' },
  '4h': { id: '4h',   name: '4 HOUR HAUL',  bends: 1.2, traffic: 1.4, cross: 1.4, calm: false, props: 1.2, finish: false, start: 'depot' },
  '8h': { id: '8h',   name: '8 HOUR HAUL',  bends: 1.4, traffic: 1.8, cross: 1.8, calm: false, props: 1.4, finish: false, start: 'depot' },
};
export const DEFAULT_TRIP = '1h';
/* the trip being driven / watched – set BEFORE the road is reset (the curvature is integrated into road.js tables on net.reset) */
export const trip = { ...TRIPS[DEFAULT_TRIP] };
export function setTrip(id) { for (const k of Object.keys(trip)) delete trip[k]; Object.assign(trip, TRIPS[id] ?? TRIPS[DEFAULT_TRIP]); return trip; }   // (a row's own keys only: `seconds` must not leak into the next trip)
/** the free levels, easiest first – read by the server's drift spec (server/test/unit/domain/ride-trip.spec.ts) against ride-trip.ts FREE_LEVELS; the lobby takes its picker from GET /api/tiers */
export const FREE_LEVELS = Object.values(TRIPS).filter(t => t.level).sort((a, b) => a.level - b.level);
/** the trip id of a ride payload: what the server stamped, 'classic' for a ride from before trips (null), its tier from a server without the field */
export const tripOf = r => r.trip !== undefined ? (r.trip ?? 'classic') : r.tier;
