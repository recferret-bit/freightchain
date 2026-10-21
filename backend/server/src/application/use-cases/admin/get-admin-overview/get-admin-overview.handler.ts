import { Optional } from '@nestjs/common';
import { QueryHandler, type IQueryHandler } from '@nestjs/cqrs';
import type { AdminOverviewDto } from '../../../../domain/admin/admin.dto.js';
import { DAY_MS } from '../../../../domain/shared/time.js';
import { AlertOutboxRepositoryPort } from '../../../ports/admin/alert-outbox.repository.port.js';
import { CachePort } from '../../../ports/shared/cache.port.js';
import { AdminQueryPort, type AdminCounts } from '../../../ports/admin/admin-query.port.js';
import { SignInRepositoryPort } from '../../../ports/auth/sign-in.repository.port.js';
import { RulesConfigPort } from '../../../ports/config/rules-config.port.js';
import { ClockPort } from '../../../ports/shared/clock.port.js';
import { GetAdminOverviewQuery } from './get-admin-overview.query.js';

const COUNTS_KEY = 'admin:counts';
export const COUNTS_TTL_SECONDS = 15;

/** The admin page's first screen: counts across the whole app, sign-ins of the last 24 h, and the verified-play switches as they are set. */
@QueryHandler(GetAdminOverviewQuery)
export class GetAdminOverviewHandler implements IQueryHandler<GetAdminOverviewQuery, AdminOverviewDto> {
  constructor(
    private readonly admin: AdminQueryPort,
    private readonly signIns: SignInRepositoryPort,
    private readonly rules: RulesConfigPort,
    private readonly clock: ClockPort,
    private readonly cache: CachePort,
    @Optional() private readonly alerts?: AlertOutboxRepositoryPort,
  ) {}

  async execute(): Promise<AdminOverviewDto> {
    const now = this.clock.now();
    const [counts, flagged, underReview, signIns24h, active, undeliveredAlerts] = await Promise.all([
      this.counts(), this.admin.flaggedCount(), this.admin.queueCount(), this.signIns.countSince(new Date(now.getTime() - DAY_MS)),
      this.alerts?.active(20) ?? Promise.resolve([]), this.alerts?.countUndelivered() ?? Promise.resolve(0),
    ]);
    const { verdictEnforce, telemetryRetentionDays } = this.rules.get();
    const activeAlerts = active.map((row) => ({ id: row.id, kind: row.kind, text: row.text, at: row.createdAt.getTime() }));
    // the review queue is what an admin acts on: its number is live (an indexed count), so it never disagrees with the tab's badge after a decision
    return { now: now.getTime(), ...counts, underReview, verdicts: { ...counts.verdicts, flagged }, signIns24h, config: { verdictEnforce, telemetryRetentionDays }, activeAlerts, undeliveredAlerts };
  }

  /** the counts scan whole tables (rides, verdicts, every recording batch): at most one scan per COUNTS_TTL_SECONDS, however often the page is opened or refreshed */
  private async counts(): Promise<AdminCounts> {
    const hit = await this.cache.get<AdminCounts>(COUNTS_KEY);
    if (hit) return hit;
    const fresh = await this.admin.counts();
    await this.cache.set(COUNTS_KEY, fresh, COUNTS_TTL_SECONDS);
    return fresh;
  }
}
