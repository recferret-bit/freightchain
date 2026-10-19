import { QueryHandler, type IQueryHandler } from '@nestjs/cqrs';
import type { ReplaysDto } from '../../../../domain/lobby/lobby.dto.js';
import { failCode } from '../../../../domain/rides/fail-code.js';
import { RideQueryPort } from '../../../ports/rides/ride-query.port.js';
import { GetReplaysQuery } from './get-replays.query.js';

/** PUBLIC – every ride that started and ended (completed, abandoned, failed – a vanished tab included, the stale-ride sweeper closes those), newest end
    first, paged by a stable (endedAt, seq) cursor, each saying whether its recording is still kept (a replay on the watch page). No reason text. */
@QueryHandler(GetReplaysQuery)
export class GetReplaysHandler implements IQueryHandler<GetReplaysQuery, ReplaysDto> {
  constructor(private readonly rideQuery: RideQueryPort) {}

  async execute({ before, limit, wallet, status }: GetReplaysQuery): Promise<ReplaysDto> {
    const rows = await this.rideQuery.history({ before, limit: limit + 1, wallet, status });   // one extra row tells whether there is a next page
    const page = rows.slice(0, limit), last = page.at(-1);
    return {
      rows: page.map((r) => ({
        id: r.id, wallet: r.wallet, tier: r.tier, route: r.route, status: r.status, failCode: r.status === 'failed' ? failCode(r.reason) : null,
        distance: Math.round(r.lastS), driveSeconds: Math.round(r.driveSeconds), minSeconds: r.minSeconds, timeScale: r.timeScale,
        startedAt: r.startedAt.getTime(), endedAt: r.endedAt.getTime(), replay: r.recorded,
      })),
      next: rows.length > limit && last ? `${last.endedAt.getTime()}_${last.seq}` : null,
    };
  }
}
