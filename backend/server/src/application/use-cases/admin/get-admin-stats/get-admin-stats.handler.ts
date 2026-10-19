import { QueryHandler, type IQueryHandler } from '@nestjs/cqrs';
import type { AdminStatsDto } from '../../../../domain/admin/admin.dto.js';
import { toStatsDto } from '../../../../domain/stats/stats.js';
import { AdminDirectoryPort } from '../../../ports/admin/admin-directory.port.js';
import { StatsRepositoryPort } from '../../../ports/stats/stats.repository.port.js';
import { ClockPort } from '../../../ports/shared/clock.port.js';
import { GetAdminStatsQuery } from './get-admin-stats.query.js';

/** The running totals (docs/spec/platform_services.md): the whole game, the newest `days` UTC days, the top riders by distance. Read-only – `stats:reconcile` repairs drift. */
@QueryHandler(GetAdminStatsQuery)
export class GetAdminStatsHandler implements IQueryHandler<GetAdminStatsQuery, AdminStatsDto> {
  constructor(
    private readonly stats: StatsRepositoryPort,
    private readonly directory: AdminDirectoryPort,
    private readonly clock: ClockPort,
  ) {}

  async execute({ days, top }: GetAdminStatsQuery): Promise<AdminStatsDto> {
    const now = this.clock.now();
    const [global, drivers, daily, riders] = await Promise.all([this.stats.findGlobal(), this.stats.countDrivers(), this.stats.listDaily(days, now), this.directory.topRiders(top)]);
    return {
      now: now.getTime(),
      global: global ? { ...toStatsDto(global.totals), drivers, updatedAt: global.updatedAt.getTime() } : null,
      daily,
      top: riders.map((r) => ({ wallet: r.wallet, stats: toStatsDto(r.totals) })),
    };
  }
}
