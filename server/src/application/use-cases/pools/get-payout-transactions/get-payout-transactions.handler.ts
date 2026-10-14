import { QueryHandler, type IQueryHandler } from '@nestjs/cqrs';
import { poolPayouts, TOP20_SIZE } from '../../../../domain/economy/pool-payouts.js';
import { prizeBound } from '../../../../domain/economy/vault-split.js';
import { ConflictError, ForbiddenError, NotFoundError } from '../../../../domain/shared/errors.js';
import { RulesConfigPort } from '../../../ports/config/rules-config.port.js';
import { ChainEventRepositoryPort } from '../../../ports/economy/chain-event.repository.port.js';
import { PoolChainPort } from '../../../ports/economy/pool-chain.port.js';
import { PoolRepositoryPort } from '../../../ports/economy/pool.repository.port.js';
import { RideQueryPort } from '../../../ports/rides/ride-query.port.js';
import { ClockPort } from '../../../ports/shared/clock.port.js';
import { AttestationService } from '../../../services/attestation.service.js';
import { GetPayoutTransactionsQuery, type PayoutTransactionsDto, type PayoutTxDto } from './get-payout-transactions.query.js';

/**
 * Admin only (the wallet in TREASURY_PUBKEY – the program's authority): the payouts of an active pool after its review window (payout_at – the program refuses
 * any prize before it), ranked by the VERIFIED completed rides paid with its tickets (always – shadow mode is for the public boards, never for money) (top 3 25 / 15 / 10 parts of 70, top 20 share 20 parts – domain/economy/pool-payouts.ts), as unsigned pay_prize transactions the admin
 * signs in Phantom (the admin pays their fee). A winner without a VERIFIED attestation gets its record_attestation (the server's verdict + the recording's Merkle
 * root, signed by the same admin) in front of its pay_prize – program v3 pays no prize without one. Ranks already paid on chain are left out; close_pool follows once none is left. The server holds no key.
 */
@QueryHandler(GetPayoutTransactionsQuery)
export class GetPayoutTransactionsHandler implements IQueryHandler<GetPayoutTransactionsQuery, PayoutTransactionsDto> {
  constructor(
    private readonly pools: PoolRepositoryPort,
    private readonly rides: RideQueryPort,
    private readonly events: ChainEventRepositoryPort,
    private readonly chain: PoolChainPort,
    private readonly rules: RulesConfigPort,
    private readonly clock: ClockPort,
    private readonly attestation: AttestationService,
  ) {}

  async execute({ wallet, poolId }: GetPayoutTransactionsQuery): Promise<PayoutTransactionsDto> {
    if (!this.rules.get().treasury || wallet !== this.rules.get().treasury) throw new ForbiddenError('payouts are signed by the pool authority only', 'not_admin');
    const pool = await this.pools.findById(poolId);
    if (!pool) throw new NotFoundError('no such pool');
    if (!pool.isActive) throw new ConflictError(`this pool is ${pool.status} – only a live pool pays prizes`, 'not_payable');
    if (this.clock.now().getTime() < pool.payoutAt.getTime()) throw new ConflictError('prizes are paid after the review window', 'too_early');
    if (pool.hold) throw new ConflictError(`the payout of this pool is on hold (${pool.hold.note ?? pool.hold.by})`, 'held');   // the same gates as the payout job (WP2 review)
    if ((await this.rides.poolUnreviewed(poolId, 1)).length) throw new ConflictError('a ride of this pool waits for an admin\'s decision', 'waiting_review');
    const s = pool.snapshot();
    const prizeLamports = prizeBound({ priceLamports: s.priceLamports, ticketsSold: s.ticketsSold, sponsored: s.sponsored, prizeBps: s.prizeBps, seedBps: s.seedBps });
    const ranking = await this.rides.poolRanking(poolId, TOP20_SIZE, true); // verified recordings only – money never follows shadow mode
    const paidTo = new Set((await this.events.recentOfPool(poolId, 500)).filter((e) => e.kind === 'PrizePaid' && e.wallet).map((e) => e.wallet as string));
    const amounts = new Map(poolPayouts(prizeLamports, ranking.map((r) => r.wallet)).map((p) => [p.wallet, p.lamports]));
    const ranks = ranking.map((r, i) => ({ rank: i + 1, wallet: r.wallet, distance: Math.round(r.distance), rides: r.rides, lamports: amounts.get(r.wallet) ?? 0, paid: paidTo.has(r.wallet) }));
    const transactions: PayoutTxDto[] = [];
    for (const r of ranks.filter((x) => !x.paid && x.lamports > 0)) {
      const attest = (await this.attestation.verifiedFacts(poolId, r.wallet)) ?? undefined;
      const tx = await this.chain.buildPayPrizeTransaction({ authority: wallet, poolId, to: r.wallet, lamports: r.lamports, rank: r.rank, attest });
      transactions.push({ rank: r.rank, to: r.wallet, lamports: r.lamports, transaction: tx.transaction, message: tx.message, lastValidBlockHeight: tx.lastValidBlockHeight });
    }
    const closeTx = transactions.length === 0 ? await this.chain.buildClosePoolTransaction({ authority: wallet, poolId }) : null;
    return {
      poolId, prizeLamports, ranks, transactions,
      close: closeTx ? { transaction: closeTx.transaction, message: closeTx.message, lastValidBlockHeight: closeTx.lastValidBlockHeight } : null,
    };
  }
}
