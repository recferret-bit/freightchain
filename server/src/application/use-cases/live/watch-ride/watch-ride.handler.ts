import { QueryHandler, type IQueryHandler } from '@nestjs/cqrs';
import { FEED_PAGE, WATCH_BATCH_PAGE } from '../../../../domain/live/live-rules.js';
import { toRideEventDto, withoutMuted, type WatchDto } from '../../../../domain/live/live.dto.js';
import { liveFeatures } from '../../../../domain/live/live-features.js';
import { RideMuteRepositoryPort } from '../../../ports/live/ride-mute.repository.port.js';
import { RideStatus } from '../../../../domain/rides/ride-status.js';
import { holeOutcomes } from '../../../../domain/verdict/world-checks.js';
import { ForbiddenError, NotFoundError } from '../../../../domain/shared/errors.js';
import { RulesConfigPort } from '../../../ports/config/rules-config.port.js';
import { RideEventRepositoryPort } from '../../../ports/live/ride-event.repository.port.js';
import { ViewerPresencePort } from '../../../ports/live/viewer-presence.port.js';
import { RideRepositoryPort } from '../../../ports/rides/ride.repository.port.js';
import { ClockPort } from '../../../ports/shared/clock.port.js';
import { RideBatchRepositoryPort } from '../../../ports/telemetry/ride-batch.repository.port.js';
import { WatchRideQuery } from './watch-ride.query.js';

/**
 * PUBLIC – anyone may watch any ride that has started (live, or a replay of a finished one while its recording is kept: TELEMETRY_RETENTION_DAYS).
 * The replay is the verified-play recording itself (10 Hz samples, ~15 s batches), so a live view runs about one batch behind the driver.
 * Each batch also says what the truck did at the server's planned holes in it (`road`: hit / avoided / IGNORED – driven through undamaged), so a replay can
 * show a game that left the holes out. Never exposed: the input events (the verdict's human-timing check reads their ms timing), the end reason, payments. What spectators see of the inputs is the
 * samples' input column (SAMPLE_INPUT_COL): the controls in use per 100 ms sample – the replay's input display, no timing finer than that.
 */
@QueryHandler(WatchRideQuery)
export class WatchRideHandler implements IQueryHandler<WatchRideQuery, WatchDto> {
  constructor(
    private readonly rides: RideRepositoryPort,
    private readonly batches: RideBatchRepositoryPort,
    private readonly events: RideEventRepositoryPort,
    private readonly viewers: ViewerPresencePort,
    private readonly mutes: RideMuteRepositoryPort,
    private readonly rules: RulesConfigPort,
    private readonly clock: ClockPort,
  ) {}

  async execute({ rideId, from, after, viewer, since, source, leave }: WatchRideQuery): Promise<WatchDto> {
    const ride = await this.rides.findById(rideId);
    if (!ride || !ride.startedAt) throw new NotFoundError('ride not found'); // not started yet: nothing to watch (and no seed handed out early)
    if (ride.isFree && ride.isInStatus(RideStatus.Running)) throw new ForbiddenError('stream watching is not available on free rides', 'free_ride_no_stream');
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
        minSeconds: ride.minSeconds, completeDist: ride.completeDist, startedAt: ride.startedAt.getTime(), endedAt: ride.endedAt?.getTime() ?? null,
        driveSeconds: Math.round(ride.driveSeconds), distance: Math.round(ride.distance), hull: ride.hull === null ? null : Math.round(ride.hull),
      },
      recording: extent,
      batches: page.map((b) => ({
        seq: b.seq, t0: b.t0, t1: b.t1, samples: b.body.samples, ...(b.body.traffic ? { traffic: b.body.traffic } : {}),
        ...(b.summary.world ? { road: holeOutcomes(b.summary.world.holes.filter((p) => p.dir > 0)) } : {}), // facts about public samples on the public plan – anyone could work them out
      })),
      events: withoutMuted(events.map(toRideEventDto), muted),
      totals,
      viewers: !live ? 0 : viewer && leave ? (this.viewers.leave(ride.id, source, viewer), this.viewers.count(ride.id, now)) : viewer ? this.viewers.seen(ride.id, source, viewer, now) : this.viewers.count(ride.id, now),
      features: liveFeatures(this.rules.get().live, ride),
    };
  }
}
