import type { AdminRideRowDto } from '../../../domain/admin/admin.dto.js';
import type { Ride } from '../../../domain/rides/ride.entity.js';
import type { AdminRideRow } from '../../ports/admin/admin-query.port.js';

/** The admin page's view of one ride row – shared by the rides list and the ride detail so the two never disagree. */
export const toAdminRideRow = (r: AdminRideRow): AdminRideRowDto => ({
  id: r.id, wallet: r.wallet, tier: r.tier, status: r.status, reason: r.reason, route: r.route, distance: Math.round(r.lastS), driveSeconds: Math.round(r.driveSeconds * 10) / 10,
  timeScale: r.timeScale, createdAt: r.createdAt.getTime(), startedAt: r.startedAt?.getTime() ?? null, endedAt: r.endedAt?.getTime() ?? null, verdict: r.verdict, overridden: r.overridden,
});

/** The same row from a loaded ride + its verdict status. */
export const adminRowOf = (ride: Ride, verdict: string | null, overridden: boolean): AdminRideRow => {
  const p = ride.snapshot();
  return { id: p.id, wallet: p.wallet, tier: p.tier, status: p.status, reason: p.reason, route: p.route, lastS: p.lastS, driveSeconds: p.driveSeconds, timeScale: p.timeScale,
    createdAt: p.createdAt, startedAt: p.startedAt, endedAt: p.endedAt, verdict, overridden };
};
