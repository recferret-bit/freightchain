import { CommandHandler, type ICommandHandler } from '@nestjs/cqrs';
import { ConflictError, NotFoundError } from '../../../../domain/shared/errors.js';
import { AdminActionRepositoryPort } from '../../../ports/admin/admin-action.repository.port.js';
import { PoolRepositoryPort } from '../../../ports/economy/pool.repository.port.js';
import { ClockPort } from '../../../ports/shared/clock.port.js';
import { TransactionPort } from '../../../ports/shared/transaction.port.js';
import { AdminProofService } from '../../../services/admin-proof.service.js';
import { HoldPoolPayoutCommand, type PoolHoldDto } from './hold-pool-payout.command.js';

/**
 * Stops (or lets go of) the payout job for one pool – the admin's brake during or after the review window. Signed for exactly this pool and decision, and
 * audited, under the pool row lock (a payout pass reads the hold before it pays anything). A pool already paid or not live cannot be held.
 * The settle grace keeps running: a pool still held 14 days after its payout time is expired into refunds by the crank (the payout job logs it 3 days before).
 */
@CommandHandler(HoldPoolPayoutCommand)
export class HoldPoolPayoutHandler implements ICommandHandler<HoldPoolPayoutCommand, PoolHoldDto> {
  constructor(
    private readonly pools: PoolRepositoryPort,
    private readonly proofs: AdminProofService,
    private readonly audit: AdminActionRepositoryPort,
    private readonly transactions: TransactionPort,
    private readonly clock: ClockPort,
  ) {}

  async execute({ admin, poolId, hold, note, requestId, signature }: HoldPoolPayoutCommand): Promise<PoolHoldDto> {
    const proof = await this.proofs.prove(admin, { action: 'pool_hold', poolId, hold, note }, signature);
    return this.transactions.run(async (tx) => {
      const pool = await this.pools.findByIdForUpdate(poolId, tx);
      if (!pool) throw new NotFoundError('no such pool');
      if (hold && (pool.status !== 'open' && pool.status !== 'active')) throw new ConflictError(`this pool is ${pool.status} – there is no payout to hold`, 'not_holdable');
      if (hold && pool.payoutState === 'paid') throw new ConflictError('this pool was paid already', 'not_holdable');
      const now = this.clock.now();
      const beforeHold = pool.hold;
      if (hold) pool.putOnHold(admin, note, now); else pool.releaseHold();
      await this.pools.saveHold(poolId, pool.hold, tx);
      const held = (h: typeof beforeHold) => (h ? { held: true, by: h.by, note: h.note } : { held: false });
      await this.audit.insert({
        wallet: admin, action: hold ? 'pool.hold' : 'pool.release', target: String(poolId), role: 'admin',
        beforeState: held(beforeHold), afterState: held(pool.hold),
        detail: { note, signed: proof }, requestId, at: now,
      }, tx);
      const h = pool.hold;
      return { poolId, held: h !== null, by: h?.by ?? null, at: h?.at.getTime() ?? null, note: h?.note ?? null };
    });
  }
}
