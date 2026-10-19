import { API_BASE } from './hosts.js';
import { installPlan, planCovers, plan } from './net/obstacles.js';
import { roadObjects } from './world/chunks.js';

/* The ride's OBSTACLE PLAN from the server (online rides and replays – opt-in like online.js / watch.js; offline nothing here runs and the game rolls its
   own holes, which is the same function). GET /api/watch/:id/road?from&to returns the natural holes the server rebuilt from the ride's seed
   (server/src/domain/road); net/obstacles.js uses them instead of the local roll, so the driver drives over – and a spectator sees – the SERVER's holes,
   and the server judges the recording against the very same list. Loaded in WINDOW m stretches, AHEAD m before the truck (or the replay's playhead) needs them;
   a failed request is retried with a backoff, and until a stretch arrives the local roll answers for it (identical; `plan.fallback` lists those chunks). */
const WINDOW = 6000, AHEAD = 3000, BACK = 400;
export const roadPlan = { rideId: null, active: () => false, loading: null, failures: 0, retryAt: 0, plan };

/** follow ride `rideId`'s plan once `active()` says so (the driver: after /start – the server hands out nothing before the ride started) */
export function followRoadPlan(rideId, active = () => true) {
  Object.assign(roadPlan, { rideId, active, loading: null, failures: 0, retryAt: 0 });
}

/** every frame: fetch the next stretch when the one loaded ends less than AHEAD m in front of s (a replay's seek may land anywhere) */
export function updateRoadPlan(s) {
  if (!roadPlan.rideId || roadPlan.loading || !roadPlan.active() || performance.now() < roadPlan.retryAt) return;
  const from = Math.max(0, s - BACK), covered = planCovers(from);
  if (covered >= s + AHEAD) return;
  roadPlan.loading = load(covered, covered + WINDOW).finally(() => { roadPlan.loading = null; });
}

async function load(from, to) {
  try {
    const r = await fetch(`${API_BASE}/api/watch/${encodeURIComponent(roadPlan.rideId)}/road?from=${Math.floor(from)}&to=${Math.ceil(to)}`, { credentials: 'include', signal: AbortSignal.timeout(8000) });
    if (!r.ok) throw new Error(`road plan: server error ${r.status}`);
    const changed = installPlan(await r.json());
    if (!changed) throw new Error('road plan: not this road (another seed)');
    for (const ci of changed) roadObjects.rebuild(ci);   // only chunks already built are rebuilt (with the warning signs before them)
    roadPlan.failures = 0;
  } catch (e) {
    roadPlan.failures++; roadPlan.retryAt = performance.now() + Math.min(30_000, 1000 * 2 ** roadPlan.failures);
    if (roadPlan.failures === 1) console.warn(e.message ?? e);
  }
}
