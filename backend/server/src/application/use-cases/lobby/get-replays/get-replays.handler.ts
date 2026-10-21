import { QueryHandler, type IQueryHandler } from '@nestjs/cqrs';
import type { ReplaysDto } from '../../../../domain/lobby/lobby.dto.js';
import { failCode } from '../../../../domain/rides/fail-code.js';
import { RideQueryPort } from '../../../ports/rides/ride-query.port.js';
import { ClockPort } from '../../../ports/shared/clock.port.js';
import { GetReplaysQuery } from './get-replays.query.js';

/** PUBLIC – finished 1h replays only (no training, no rejected verdict, a pool ride only after payout unless it is the caller's). Newest end first. */
@QueryHandler(GetReplaysQuery)
export class GetReplaysHandler implements IQueryHandler<GetReplaysQuery, ReplaysDto> {
  constructor(private readonly rideQuery: RideQueryPort, private readonly clock: ClockPort) {}

  async execute({ before, limit, wallet, status, viewer }: GetReplaysQuery): Promise<ReplaysDto> {
    const rows = await this.rideQuery.history({ before, limit: limit + 1, wallet, status, board: { now: this.clock.now(), viewerWallet: viewer } });
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
