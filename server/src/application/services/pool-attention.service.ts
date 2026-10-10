import { Injectable, Logger } from '@nestjs/common';
import { POOL_TOP, poolAttention, poolStandings, type WalletSignIns } from '../../domain/verdict/pool-attention.js';
import type { VerdictReason } from '../../domain/verdict/verdict.dto.js';
import { AdminQueryPort } from '../ports/admin/admin-query.port.js';
import { SignInRepositoryPort } from '../ports/auth/sign-in.repository.port.js';
import { PlayerRepositoryPort } from '../ports/players/player.repository.port.js';
import { VerdictService } from './verdict.service.js';

/** What one `markPool` run did. `marked` lists only the rides whose verdict changed (a second run over the same rides lists none). */
export interface PoolAttentionResult {
  poolId: number;
  /** completed rides paid with the pool's tickets */
  rides: number;
  /** wallets in the pool's ranking (the checks look at the top POOL_TOP) */
  wallets: number;
  marked: { rideId: string; wallet: string; before: string | null; after: string | null; added: string[] }[];
  /** marked rides that already carried every mark */
  unchanged: number;
  /** marked rides an admin had decided – never touched */
  overridden: number;
}

/**
 * The POOL-LEVEL attention checks (domain/verdict/pool-attention.ts) run over one pool and written onto the verdicts: each marked ride's verdict gets
 * the `pool-*` flag reasons appended (so it stays UNDER REVIEW until an admin decides), one transaction per rider under that rider's player row lock
 * (VerdictService.addAttention). An admin's decision is never overwritten; running it twice changes nothing the second time. A system mark, not an
 * admin action: no audit row, a JsonLogger line `event: 'pool-attention'` per changed ride and one per run.
 * Called by the CLI (`pool:attention --pool N`) and – before it pays – by the payout job, so a pool is never paid past a mark nobody looked at.
 */
@Injectable()
export class PoolAttentionService {
  private readonly logger = new Logger(PoolAttentionService.name);

  constructor(
    private readonly admin: AdminQueryPort,
    private readonly signIns: SignInRepositoryPort,
    private readonly players: PlayerRepositoryPort,
    private readonly verdicts: VerdictService,
  ) {}

  async markPool(poolId: number): Promise<PoolAttentionResult> {
    const rides = await this.admin.poolRides(poolId);
    const standings = poolStandings(rides);
    const marks = poolAttention(poolId, rides, await this.signInFacts(standings.slice(0, POOL_TOP).map((s) => s.wallet)));
    const byWallet = new Map<string, { rideId: string; reasons: VerdictReason[] }[]>();
    for (const m of marks) byWallet.set(m.wallet, [...(byWallet.get(m.wallet) ?? []), { rideId: m.rideId, reasons: m.reasons }]);

    const result: PoolAttentionResult = { poolId, rides: rides.length, wallets: standings.length, marked: [], unchanged: 0, overridden: 0 };
    for (const [wallet, list] of byWallet) {
      for (const o of await this.verdicts.addAttention(wallet, list)) {
        if (o.skipped === 'overridden') result.overridden++;
        else if (o.added.length || o.before === null) {
          result.marked.push({ rideId: o.rideId, wallet, before: o.before, after: o.after, added: o.added });
          this.logger.log({ event: 'pool-attention', msg: `ride ${o.rideId} of pool ${poolId}: ${o.before ?? 'unjudged'} → ${o.after} (${o.added.join(', ')})`, poolId, rideId: o.rideId, wallet, before: o.before, after: o.after, added: o.added });
        } else if (!o.skipped) result.unchanged++;
      }
    }
    this.logger.log({ event: 'pool-attention', msg: `pool ${poolId}: ${rides.length} rides, ${result.marked.length} marked, ${result.unchanged} unchanged, ${result.overridden} decided by an admin`, poolId, rides: rides.length, marked: result.marked.length, unchanged: result.unchanged, overridden: result.overridden });
    return result;
  }

  /** first seen = the earlier of the player row's creation (the first sign-in made it) and the oldest KEPT sign-in (pruned after SIGNIN_RETENTION_DAYS) */
  private async signInFacts(wallets: readonly string[]): Promise<WalletSignIns[]> {
    const kept = new Map((await this.signIns.summaryOf(wallets)).map((s) => [s.wallet, s]));
    return Promise.all(wallets.map(async (wallet) => {
      const created = (await this.players.findByWallet(wallet))?.createdAt ?? null, s = kept.get(wallet);
      const firstSeen = created && s ? (created < s.firstAt ? created : s.firstAt) : (created ?? s?.firstAt ?? null);
      return { wallet, firstSeen, ips: s?.ips ?? [] };
    }));
  }
}
