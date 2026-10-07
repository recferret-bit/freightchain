import { QueryHandler, type IQueryHandler } from '@nestjs/cqrs';
import { FINISHED_LIMIT, LIVE_FEED_LIMIT, UPCOMING_LIMIT, type LiveFeedDto } from '../../../../domain/lobby/lobby.dto.js';
import { RulesConfigPort } from '../../../ports/config/rules-config.port.js';
import { RideQueryPort } from '../../../ports/rides/ride-query.port.js';
import { ClockPort } from '../../../ports/shared/clock.port.js';
import { GetLiveQuery } from './get-live.query.js';

/** The public "who is on the road" feed, plus what the landing shows around it: paid shifts waiting to start, the last finishes, all-time totals. A ride only leaves `running` when its wallet starts another, so a vanished tab would stay forever – hence the heartbeat-age filter. */
@QueryHandler(GetLiveQuery)
export class GetLiveHandler implements IQueryHandler<GetLiveQuery, LiveFeedDto> {
  constructor(
    private readonly rideQuery: RideQueryPort,
    private readonly rules: RulesConfigPort,
    private readonly clock: ClockPort,
  ) {}

  async execute(): Promise<LiveFeedDto> {
    const now = this.clock.now();
    const [rows, upcoming, finished, totals] = await Promise.all([
      this.rideQuery.live(new Date(now.getTime() - this.rules.get().hbTimeoutMs), LIVE_FEED_LIMIT),
      this.rideQuery.upcoming(UPCOMING_LIMIT), this.rideQuery.finished(FINISHED_LIMIT), this.rideQuery.totals(),
    ]);
    return {
      now: now.getTime(),
      upcoming: upcoming.map((r) => ({ wallet: r.wallet, tier: r.tier, minSeconds: r.minSeconds, paidAt: r.paidAt.getTime() })),
      recent: finished.map((r) => ({ wallet: r.wallet, tier: r.tier, route: r.route, status: r.status, distance: Math.round(r.lastS), endedAt: r.endedAt?.getTime() ?? null })),
      totals: { shifts: totals.shifts, metres: Math.round(totals.metres), drivers: totals.drivers },
      rides: rows.map((r) => ({
        wallet: r.wallet, tier: r.tier, route: r.route, timeScale: r.timeScale, paused: r.paused,
        hull: r.hull === null ? null : Math.round(r.hull), driveSeconds: Math.round(r.driveSeconds), minSeconds: r.minSeconds,
        distance: Math.round(r.lastS), completeDist: r.completeDist,
        progress: Math.min(1, r.driveSeconds / r.minSeconds, r.lastS / r.completeDist),
        sinceBeat: Math.round((now.getTime() - r.lastHbAt.getTime()) / 1000), startedAt: r.startedAt.getTime(),
      })),
    };
  }
}
