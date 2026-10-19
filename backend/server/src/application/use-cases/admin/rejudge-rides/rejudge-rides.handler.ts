import { Logger } from '@nestjs/common';
import { CommandHandler, type ICommandHandler } from '@nestjs/cqrs';
import { RULES_VERSION } from '../../../../domain/verdict/verdict-rules.js';
import { AdminActionRepositoryPort } from '../../../ports/admin/admin-action.repository.port.js';
import { RideQueryPort } from '../../../ports/rides/ride-query.port.js';
import { ClockPort } from '../../../ports/shared/clock.port.js';
import { VerdictService } from '../../../services/verdict.service.js';
import { RejudgeRidesCommand, type RejudgeRidesResultDto } from './rejudge-rides.command.js';

/**
 * After a threshold change (RULES_VERSION bump): judge the selected completed shifts again, one at a time under each owner's player lock (VerdictService),
 * never replacing an admin's decision and skipping rides whose recording the retention sweep already deleted. One audit row sums it up.
 */
@CommandHandler(RejudgeRidesCommand)
export class RejudgeRidesHandler implements ICommandHandler<RejudgeRidesCommand, RejudgeRidesResultDto> {
  private readonly logger = new Logger(RejudgeRidesHandler.name);

  constructor(
    private readonly rides: RideQueryPort,
    private readonly verdicts: VerdictService,
    private readonly audit: AdminActionRepositoryPort,
    private readonly clock: ClockPort,
  ) {}

  async execute({ filter, dryRun, by }: RejudgeRidesCommand): Promise<RejudgeRidesResultDto> {
    const rows = await this.rides.forRejudge(filter);
    const result: RejudgeRidesResultDto = { dryRun, scanned: rows.length, judged: 0, changed: [], skipped: 0, rulesVersion: RULES_VERSION };
    if (dryRun) return result;
    for (const row of rows) {
      const r = await this.verdicts.rejudgeQuietly(row.id);
      if (!r) { result.skipped++; continue; }
      result.judged++;
      if (r.before !== r.after) result.changed.push({ id: row.id, from: r.before, to: r.after });
    }
    const at = this.clock.now();
    await this.audit.insert({ wallet: by, action: 'verdict.rejudge-bulk', target: `${filter.verdict}${filter.since ? ` since ${filter.since.toISOString()}` : ''}`, detail: { ...result, changed: result.changed.slice(0, 200) }, requestId: null, at });
    this.logger.log({ event: 'admin', msg: `bulk re-judge by ${by}: ${result.judged} judged, ${result.changed.length} changed, ${result.skipped} skipped`, action: 'verdict.rejudge-bulk', admin: by, ...result, changed: result.changed.length });
    return result;
  }
}
