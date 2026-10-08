import { QueryHandler, type IQueryHandler } from '@nestjs/cqrs';
import { ConflictError, NotFoundError } from '../../../../domain/shared/errors.js';
import { PoolChainPort } from '../../../ports/economy/pool-chain.port.js';
import { PoolRepositoryPort } from '../../../ports/economy/pool.repository.port.js';
import { RideTicketRepositoryPort } from '../../../ports/players/ride-ticket.repository.port.js';
import { ClockPort } from '../../../ports/shared/clock.port.js';
import { GetRefundTransactionQuery, type RefundTransactionDto } from './get-refund-transaction.query.js';

/**
 * The lobby's CLAIM REFUND: the program's permissionless refund of everything the caller paid into a failed pool. Self-paid on purpose: the wallet signs and
 * sends it itself (Phantom signAndSend), so it never depends on this server staying up; the Ticket account it closes returns its rent to whoever paid it.
 * 409 when the pool is not refundable or the wallet paid nothing into it (promo tickets are not money).
 */
@QueryHandler(GetRefundTransactionQuery)
export class GetRefundTransactionHandler implements IQueryHandler<GetRefundTransactionQuery, RefundTransactionDto> {
  constructor(
    private readonly pools: PoolRepositoryPort,
    private readonly tickets: RideTicketRepositoryPort,
    private readonly chain: PoolChainPort,
    private readonly clock: ClockPort,
  ) {}

  async execute({ wallet, poolId }: GetRefundTransactionQuery): Promise<RefundTransactionDto> {
    const pool = await this.pools.findById(poolId);
    if (!pool) throw new NotFoundError('no such pool');
    const needsFail = pool.isPastDeadlineUnderMinimum(this.clock.now());
    if (!pool.isRefunding && !needsFail) throw new ConflictError(`this pool is ${pool.status} – refunds open only if it fails`, 'not_refundable');
    const bought = (await this.tickets.find(wallet, poolId))?.bought ?? 0;
    if (bought === 0) throw new ConflictError('this wallet paid nothing into this pool (or was refunded already)', 'nothing_to_refund');
    const tx = await this.chain.buildRefundTransaction({ caller: wallet, poolId, buyer: wallet, needsFail, selfPaid: true });
    return {
      poolId, needsFail, lamports: pool.costOf(bought), transaction: tx.transaction, message: tx.message, feePayer: tx.feePayer, sponsored: tx.feePayer !== wallet,
      lastValidBlockHeight: tx.lastValidBlockHeight,
    };
  }
}
