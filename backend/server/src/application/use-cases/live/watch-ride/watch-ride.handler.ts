import { QueryHandler, type IQueryHandler } from '@nestjs/cqrs';
import { ReplayAccessService } from '../../../live/replay-access.service.js';
import { FEED_PAGE, WATCH_BATCH_PAGE } from '../../../../domain/live/live-rules.js';
import { byReplayTime, toRideEventDto, withoutMuted, type WatchDto } from '../../../../domain/live/live.dto.js';
import { withoutPublicInputs } from '../../../../domain/live/public-samples.js';
import { liveFeatures } from '../../../../domain/live/live-features.js';
import { RideMuteRepositoryPort } from '../../../ports/live/ride-mute.repository.port.js';
import { RideStatus } from '../../../../domain/rides/ride-status.js';
import { holeOutcomes } from '../../../../domain/verdict/world-checks.js';
import { RulesConfigPort } from '../../../ports/config/rules-config.port.js';
import { RideEventRepositoryPort } from '../../../ports/live/ride-event.repository.port.js';
import { ViewerPresencePort } from '../../../ports/live/viewer-presence.port.js';
import { ClockPort } from '../../../ports/shared/clock.port.js';
import { RideBatchRepositoryPort } from '../../../ports/telemetry/ride-batch.repository.port.js';
import { WatchRideQuery } from './watch-ride.query.js';

/**
 * PUBLIC replay of a finished non-training ride (a pool ride only after payout, except to its driver). A running ride is 404.
 * The replay is the verified-play recording itself (10 Hz samples, ~15 s batches). Each batch also says what the truck did at the
 * server's planned holes (`road`). Never exposed: raw input events, the input column (zeroed), the end reason, payments.
 */
@QueryHandler(WatchRideQuery)
export class WatchRideHandler implements IQueryHandler<WatchRideQuery, WatchDto> {
  constructor(
    private readonly access: ReplayAccessService,
    private readonly batches: RideBatchRepositoryPort,
    private readonly events: RideEventRepositoryPort,
    private readonly viewers: ViewerPresencePort,
    private readonly mutes: RideMuteRepositoryPort,
    private readonly rules: RulesConfigPort,
    private readonly clock: ClockPort,
  ) {}

  async execute({ rideId, from, after, viewer, since, source, leave, caller }: WatchRideQuery): Promise<WatchDto> {
    const ride = await this.access.requireWatchable(rideId, caller);
    const now = this.clock.now();
    const [extent, page, fresh, stamped, totals, muted] = await Promise.all([
      this.batches.extent(ride.id), this.batches.listFrom(ride.id, from, WATCH_BATCH_PAGE), this.events.listAfter(ride.id, after, FEED_PAGE),
      since > 0 ? this.events.listAppliedSince(ride.id, new Date(since), FEED_PAGE) : Promise.resolve([]), this.events.totals(ride.id), this.mutes.list(ride.id),
    ]);
    const events = [...fresh, ...stamped.filter((e) => !fresh.some((f) => f.id === e.id))].sort((a, b) => (a.id ?? 0) - (b.id ?? 0));
    const live = ride.isInStatus(RideStatus.Running) && !ride.isStaleRunning(now, this.rules.get());
    return {
      now: now.getTime(),
      ride: {
        id: ride.id, wallet: ride.wallet, tier: ride.tier, trip: ride.trip, level: ride.level, route: ride.route, loadout: ride.loadout, seed: ride.seed, status: ride.status, live, timeScale: ride.timeScale,
        minSeconds: ride.minSeconds, completeDist: ride.completeDist, startedAt: ride.startedAt?.getTime() ?? 0, endedAt: ride.endedAt?.getTime() ?? null,
        driveSeconds: Math.round(ride.driveSeconds), distance: Math.round(ride.distance), hull: ride.hull === null ? null : Math.round(ride.hull),
        poolId: ride.props.poolId ?? null, ranked: ride.ranked,
      },
      recording: extent,
      batches: page.map((b) => ({
        seq: b.seq, t0: b.t0, t1: b.t1, samples: withoutPublicInputs(b.body.samples), ...(b.body.traffic ? { traffic: b.body.traffic } : {}),
        ...(b.summary.world ? { road: holeOutcomes(b.summary.world.holes.filter((p) => p.dir > 0)) } : {}), // facts about public samples on the public plan – anyone could work them out
      })),
      events: byReplayTime(withoutMuted(events.map(toRideEventDto), muted)),
      totals,
      viewers: viewer && leave ? (await this.viewers.leave(ride.id, source, viewer), await this.viewers.count(ride.id, now)) : viewer ? await this.viewers.seen(ride.id, source, viewer, now) : await this.viewers.count(ride.id, now),
      features: liveFeatures(this.rules.get().live, ride),
    };
  }
}
