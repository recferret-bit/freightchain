import { QueryHandler, type IQueryHandler } from '@nestjs/cqrs';
import { FINISHED_LIMIT, LIVE_FEED_LIMIT, UPCOMING_LIMIT, WEAK_SIGNAL_SECONDS, type LiveFeedDto } from '../../../../domain/lobby/lobby.dto.js';
import { RulesConfigPort } from '../../../ports/config/rules-config.port.js';
import { SitePresencePort } from '../../../ports/live/site-presence.port.js';
import { ViewerPresencePort } from '../../../ports/live/viewer-presence.port.js';
import { RideQueryPort } from '../../../ports/rides/ride-query.port.js';
import { ClockPort } from '../../../ports/shared/clock.port.js';
import { GetLiveQuery } from './get-live.query.js';

const PAGES = new Set(['landing', 'lobby']);

/** The public "who is on the road" feed, plus what the landing shows around it: paid shifts waiting to start, the last finishes, all-time totals and who is
    online. Only rides with a heartbeat within HB_TIMEOUT_MS are on the road (the stale-ride sweeper ends the others); each carries its viewers and signal.
    The polling page itself is counted online (visitor + page) – soft, in-memory numbers. */
@QueryHandler(GetLiveQuery)
export class GetLiveHandler implements IQueryHandler<GetLiveQuery, LiveFeedDto> {
  constructor(
    private readonly rideQuery: RideQueryPort,
    private readonly rules: RulesConfigPort,
    private readonly clock: ClockPort,
    private readonly presence: SitePresencePort,
    private readonly viewers: ViewerPresencePort,
  ) {}

  async execute({ visitor, page, source, wallet, leave }: GetLiveQuery = new GetLiveQuery()): Promise<LiveFeedDto> {
    const now = this.clock.now();
    if (visitor && leave) this.presence.leave(source, visitor);   // a closing page's beacon
    else if (visitor && PAGES.has(page)) this.presence.seen(source, visitor, page, wallet, now);
    const [rows, upcoming, finished, totals] = await Promise.all([
      this.rideQuery.live(new Date(now.getTime() - this.rules.get().hbTimeoutMs), LIVE_FEED_LIMIT),
      this.rideQuery.upcoming(UPCOMING_LIMIT), this.rideQuery.finished(FINISHED_LIMIT), this.rideQuery.totals(),
    ]);
    const site = this.presence.snapshot(now), watching = this.viewers.watching(now);
    const players = new Set([...site.wallets, ...rows.map((r) => r.wallet)]);
    return {
      now: now.getTime(),
      upcoming: upcoming.map((r) => ({ wallet: r.wallet, tier: r.tier, minSeconds: r.minSeconds, paidAt: r.paidAt.getTime() })),
      recent: finished.map((r) => ({ id: r.id, wallet: r.wallet, tier: r.tier, route: r.route, status: r.status, distance: Math.round(r.lastS), endedAt: r.endedAt?.getTime() ?? null })),
      totals: { shifts: totals.shifts, metres: Math.round(totals.metres), drivers: totals.drivers },
      online: { total: site.visitors + watching + rows.length, browsing: site.visitors, watching, driving: rows.length, players: players.size },
      rides: rows.map((r) => {
        const sinceBeat = Math.round((now.getTime() - r.lastHbAt.getTime()) / 1000);
        return {
          id: r.id, wallet: r.wallet, tier: r.tier, route: r.route, timeScale: r.timeScale, paused: r.paused,
          hull: r.hull === null ? null : Math.round(r.hull), driveSeconds: Math.round(r.driveSeconds), minSeconds: r.minSeconds,
          distance: Math.round(r.lastS), completeDist: r.completeDist,
          progress: Math.min(1, r.driveSeconds / r.minSeconds, r.lastS / r.completeDist),
          sinceBeat, startedAt: r.startedAt.getTime(),
          viewers: this.viewers.count(r.id, now), signal: r.paused ? 'paused' as const : sinceBeat > WEAK_SIGNAL_SECONDS ? 'weak' as const : 'live' as const,
        };
      }),
    };
  }
}
