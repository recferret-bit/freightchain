/* For the harnesses that build a recording BY HAND (sim-rides.mjs, e2e-verified-play.mjs, e2e-verified-deep.mjs): drive the server's road honestly.
   The server judges every recording against the ride's obstacle plan (server/src/domain/road – holes rebuilt from the seed): a truck whose wheels run
   through a planned hole at speed must lose the hull the game takes there, or the verdict says 'obstacle-ignored'. `honestRoad(BASE, rideId)` fetches the
   plan (GET /api/watch/:id/road – public, like the game's own road-plan.js) and `take(rows)` applies the game's damage (client/js/sim/damage.js hitHoles:
   per pit and axle once per ride, holeDamage of road-rules.ts) to the rows' hull column in place, carrying the loss on across batches. */
import { HOLES } from '../../../frontend/client/js/net/obstacles.js';

const AXLES = [2.2, -0.4, -11.5], WHEEL = 1, REAR = 0.6, CRAWL = 3, MIN_HURT = 0.3, REF = 28, CH = 32;   // sim/damage.js – mirrored in server/src/domain/road/road-rules.ts
const HULL = 7;

export function damageOf(type, v, axle) {
  if (v < CRAWL) return 0;
  const dmg = HOLES[type].dmg * Math.min(Math.max(v / REF, 0), 1.2) ** 2 * (axle ? REAR : 1);
  return dmg >= MIN_HURT ? dmg : 0;
}

export function honestRoad(base, rideId) {
  const holes = new Map(), hit = new Set();
  let lost = 0, loadedTo = 0, prev = null;
  async function ensure(s) {
    while (loadedTo < s + 50) {
      const res = await fetch(`${base}/api/watch/${encodeURIComponent(rideId)}/road?from=${loadedTo}&to=${loadedTo + 6000}`);
      if (!res.ok) throw new Error(`road plan ${res.status}`);
      const j = await res.json();
      for (const h of j.holes) holes.set(h.ci, h);
      loadedTo = j.to;
    }
  }
  const near = (a, b) => { const out = []; for (let ci = Math.floor((a - 8) / CH); ci <= Math.floor((b + 8) / CH); ci++) if (holes.has(ci)) out.push(holes.get(ci)); return out; };
  return {
    get lost() { return lost; },
    /** apply the planned holes' damage to `rows` (10 Hz samples, in order, continuing the rows given before) – in place */
    async take(rows) {
      if (!rows.length) return rows;
      await ensure(Math.max(...rows.map((r) => r[1])) + 20);
      for (const q of rows) {
        const p = prev;
        if (p) AXLES.forEach((ax, axle) => {
          const a0 = p[1] + ax, a1 = q[1] + ax;
          if (a1 <= a0) return;
          for (const h of near(a0 - 4, a1 + 4)) HOLES[h.type].ells.forEach((e, pit) => {
            const key = `${h.id}:${pit}:${axle}`, entry = h.s + e.ds - e.a, cl = h.lat + e.dl;
            if (hit.has(key) || !(entry > a0 && entry <= a1)) return;
            if (Math.min(Math.abs(q[2] - WHEEL - cl), Math.abs(q[2] + WHEEL - cl)) >= e.b) return;
            hit.add(key); lost += damageOf(h.type, p[4], axle);
          });
        });
        q[HULL] = Math.round(Math.max(0, q[HULL] - lost) * 10) / 10;
        prev = q;
      }
      return rows;
    },
  };
}
