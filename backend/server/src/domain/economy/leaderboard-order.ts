import type { LeaderboardSort } from './economy.dto.js';

/** One wallet's totals on a board, plus the earliest finish (ms; Infinity when unknown, so it sorts last). */
export interface LeaderboardKeys {
  wallet: string;
  distance: number;
  seconds: number;
  /** hull at the end of the furthest counted ride; null sorts last */
  hull: number | null;
  rides: number;
  first: number;
}

/** Negative when `a` ranks above `b`. Distance is the prize order; the other sorts break their own ties the same way
    (distance, then more rides, then the earlier first finish, then wallet). The SQL `ORDER BY` in
    `RideQueryPrismaRepository` is this order — change both together. */
export function compareLeaderboard(sort: LeaderboardSort, a: LeaderboardKeys, b: LeaderboardKeys): number {
  const hull = hullKey(b.hull) - hullKey(a.hull);
  const distance = b.distance - a.distance;
  const seconds = b.seconds - a.seconds;
  const rides = b.rides - a.rides;
  const first = a.first - b.first;   // NaN (both unknown) falls through; a real finish beats Infinity
  const wallet = a.wallet < b.wallet ? -1 : a.wallet > b.wallet ? 1 : 0;
  const tail = first || wallet;
  if (sort === 'time') return seconds || distance || rides || tail;
  if (sort === 'hull') return hull || distance || rides || tail;
  if (sort === 'rides') return rides || distance || tail;
  return distance || rides || tail;
}

/** null hull sorts last on a descending hull order (Postgres `DESC NULLS LAST`) */
const hullKey = (hull: number | null): number => (hull == null ? Number.NEGATIVE_INFINITY : hull);
