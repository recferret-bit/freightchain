import { CommandHandler, type ICommandHandler } from '@nestjs/cqrs';
import { EMPTY_STATS, addStats, statsDrift, type StatsTotals } from '../../../../domain/stats/stats.js';
import { CachePort } from '../../../ports/shared/cache.port.js';
import { ClockPort } from '../../../ports/shared/clock.port.js';
import { StatsRepositoryPort } from '../../../ports/stats/stats.repository.port.js';
import { GLOBAL_STATS_KEY, playerStatsKey } from '../../../services/stats.service.js';
import { ReconcileStatsCommand, type ReconcileStatsResultDto, type StatsDriftDto } from './reconcile-stats.command.js';

/**
 * Statistics are running totals, so a crash between two writes (or a row edited by hand) can leave them off. This recomputes every rider's numbers from the
 * rides and the donation events – the same rule the migration's backfill used – diffs them with the stored rows and the global row, and with `fix` rewrites
 * the rows (a rider with nothing behind it loses the row; the global row becomes the sum of all riders). Read-only without `fix`. Run it when the app is quiet:
 * a ride that ends while it runs is counted by the live write and may then be overwritten by an older snapshot – run it again and it is clean.
 */
@CommandHandler(ReconcileStatsCommand)
export class ReconcileStatsHandler implements ICommandHandler<ReconcileStatsCommand, ReconcileStatsResultDto> {
  constructor(
    private readonly repo: StatsRepositoryPort,
    private readonly cache: CachePort,
    private readonly clock: ClockPort,
  ) {}

  async execute({ wallet, fix }: ReconcileStatsCommand): Promise<ReconcileStatsResultDto> {
    const [truth, stored] = await Promise.all([this.repo.recompute(wallet ?? undefined), this.repo.listPlayers(wallet ?? undefined)]);
    const drifted: StatsDriftDto[] = [];
    for (const w of new Set([...truth.keys(), ...stored.keys()])) {
      const fields = statsDrift(stored.get(w) ?? EMPTY_STATS, truth.get(w) ?? EMPTY_STATS);
      if (Object.keys(fields).length) drifted.push({ wallet: w, fields });
    }
    let global: ReconcileStatsResultDto['global'] = null;
    if (!wallet) {
      const sum = [...truth.values()].reduce<StatsTotals>(addStats, EMPTY_STATS);
      global = statsDrift((await this.repo.findGlobal())?.totals ?? EMPTY_STATS, sum);
    }
    const dirty = drifted.length > 0 || (global !== null && Object.keys(global).length > 0);
    if (fix && dirty) {
      await this.repo.replace(truth, this.clock.now(), wallet);
      await this.cache.del(GLOBAL_STATS_KEY, ...drifted.map((d) => playerStatsKey(d.wallet)));
    }
    return { checked: new Set([...truth.keys(), ...stored.keys()]).size, drifted, global: global && Object.keys(global).length ? global : null, fixed: fix && dirty };
  }
}
