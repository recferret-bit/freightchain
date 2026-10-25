import { Injectable, Optional } from '@nestjs/common';
import type { Pool } from '../../domain/economy/pool.entity.js';
import { scheduleMismatch } from '../../domain/economy/pool-schedule.js';
import { ConflictError } from '../../domain/shared/errors.js';
import { AlertOutboxRepositoryPort } from '../ports/admin/alert-outbox.repository.port.js';
import { RulesConfigPort } from '../ports/config/rules-config.port.js';
import { PoolChainPort } from '../ports/economy/pool-chain.port.js';
import { ClockPort } from '../ports/shared/clock.port.js';
import { EntropyPort } from '../ports/shared/entropy.port.js';

/**
 * Program-mode guard for a ticket buy or a pool-ride start. The chain account is the truth for prep / play / payout.
 * v6 compares explicit chain opens/last-start; historical fixtures derive those timestamps from creation/play close.
 * A stored column that disagrees is `409 pool_schedule_mismatch` plus an admin alert. The alert is written outside the caller's transaction.
 */
@Injectable()
export class PoolScheduleService {
  constructor(
    private readonly chain: PoolChainPort,
    private readonly clock: ClockPort,
    private readonly entropy: EntropyPort,
    @Optional() private readonly alerts?: AlertOutboxRepositoryPort,
    @Optional() private readonly rules?: RulesConfigPort,
  ) {}

  async assertSynced(pool: Pool): Promise<void> {
    if (this.rules?.get().paymentMode === 'transfer') return;
    // RPC failure is unavailable, not schedule drift: v6 timestamps cannot be reconstructed from legacy defaults.
    const chain = await this.chain.readPool(pool.id);
    const why = scheduleMismatch(pool.snapshot(), chain);
    if (!why) return;
    const now = this.clock.now();
    if (this.alerts) {
      await this.alerts.insert({
        id: this.entropy.uuid(), kind: 'pool_schedule_mismatch', money: true, status: 'pending', attempts: 0, nextAttemptAt: now, lastError: null, createdAt: now, sentAt: null, requestId: null,
        text: `pool ${pool.id} schedule does not match the chain (${why})`,
      });
    }
    throw new ConflictError(`pool ${pool.id} schedule does not match the chain (${why})`, 'pool_schedule_mismatch');
  }

  /** Buy or start. Mismatch first, then the last-start cutoff. */
  async assertEntry(pool: Pool, now: Date): Promise<void> {
    await this.assertSynced(pool);
    if (now.getTime() > pool.lastStartAt.getTime()) {
      throw new ConflictError(`the last start for pool #${pool.id} was ${pool.lastStartAt.toISOString()}`, 'pool_last_start_passed');
    }
  }
}
