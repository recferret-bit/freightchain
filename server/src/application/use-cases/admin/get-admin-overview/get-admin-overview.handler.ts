import { QueryHandler, type IQueryHandler } from '@nestjs/cqrs';
import type { AdminOverviewDto } from '../../../../domain/admin/admin.dto.js';
import { DAY_MS } from '../../../../domain/shared/time.js';
import { AdminQueryPort } from '../../../ports/admin/admin-query.port.js';
import { SignInRepositoryPort } from '../../../ports/auth/sign-in.repository.port.js';
import { RulesConfigPort } from '../../../ports/config/rules-config.port.js';
import { ClockPort } from '../../../ports/shared/clock.port.js';
import { GetAdminOverviewQuery } from './get-admin-overview.query.js';

/** The admin page's first screen: counts across the whole app, sign-ins of the last 24 h, and the verified-play switches as they are set. */
@QueryHandler(GetAdminOverviewQuery)
export class GetAdminOverviewHandler implements IQueryHandler<GetAdminOverviewQuery, AdminOverviewDto> {
  constructor(
    private readonly admin: AdminQueryPort,
    private readonly signIns: SignInRepositoryPort,
    private readonly rules: RulesConfigPort,
    private readonly clock: ClockPort,
  ) {}

  async execute(): Promise<AdminOverviewDto> {
    const now = this.clock.now();
    const [counts, signIns24h] = await Promise.all([this.admin.counts(), this.signIns.countSince(new Date(now.getTime() - DAY_MS))]);
    const { verdictEnforce, telemetryRetentionDays } = this.rules.get();
    return { now: now.getTime(), ...counts, signIns24h, config: { verdictEnforce, telemetryRetentionDays } };
  }
}
