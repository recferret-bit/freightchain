import { Optional } from '@nestjs/common';
import { QueryHandler, type IQueryHandler } from '@nestjs/cqrs';
import type { AdminReplaysDto } from '../../../../domain/admin/admin.dto.js';
import { ReplayQueuePort } from '../../../ports/verdict/replay-queue.port.js';
import { RideReplayRepositoryPort } from '../../../ports/verdict/ride-replay.repository.port.js';
import { ListAdminReplaysQuery } from './list-admin-replays.query.js';

/** Lists recent replay verification sessions across rides and reports the current ReplayQueuePort depth and kind. */
@QueryHandler(ListAdminReplaysQuery)
export class ListAdminReplaysHandler implements IQueryHandler<ListAdminReplaysQuery, AdminReplaysDto> {
  constructor(
    private readonly replays: RideReplayRepositoryPort,
    @Optional() private readonly queue?: ReplayQueuePort,
  ) {}

  async execute({ filter }: ListAdminReplaysQuery): Promise<AdminReplaysDto> {
    const [rows, depth] = await Promise.all([
      this.replays.listRecent(filter),
      this.queue ? this.queue.depth() : Promise.resolve(0),
    ]);
    return {
      queue: { kind: this.queue?.kind ?? 'memory', depth },
      rows: rows.map((r) => r.toDto()),
    };
  }
}
