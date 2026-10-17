import { Optional } from '@nestjs/common';
import { QueryHandler, type IQueryHandler } from '@nestjs/cqrs';
import { Pool } from '../../../../domain/economy/pool.entity.js';
import { poolPayouts, TOP20_SIZE } from '../../../../domain/economy/pool-payouts.js';
import { prizeBound } from '../../../../domain/economy/vault-split.js';
import { ConflictError, ForbiddenError, NotFoundError } from '../../../../domain/shared/errors.js';
import { RulesConfigPort } from '../../../ports/config/rules-config.port.js';
import { PoolChainPort } from '../../../ports/economy/pool-chain.port.js';
import { PoolRepositoryPort } from '../../../ports/economy/pool.repository.port.js';
import { RideQueryPort } from '../../../ports/rides/ride-query.port.js';
import { ClockPort } from '../../../ports/shared/clock.port.js';
import { HasherPort } from '../../../ports/shared/hasher.port.js';
import { winnersTree } from '../../../../domain/economy/winners-merkle.js';
import { ReferralPayoutService } from '../../../services/referral-payout.service.js';
import { GetPayoutTransactionsQuery, type PayoutTransactionsDto, type PayoutTxDto, type SignableTxDto } from './get-payout-transactions.query.js';

/**
 * Admin only (the wallet in TREASURY_PUBKEY – the program's authority): the payouts of an active pool once its rides are over (`playDeadline`), ranked by the VERIFIED
 * completed rides paid with its tickets (always – shadow mode is for the public boards, never for money) (top 3 25 / 15 / 10 parts of 70, top 20 share 20 parts –
 * domain/economy/pool-payouts.ts), as unsigned transactions the admin signs in Phantom (the admin pays their fee). Program v4 (audit H5-B): the ranking is first
 * COMMITTED as a winners root (public until its lock ends – `payFrom`), then each rank is paid with its Merkle proof, then the pool closes; a committed root that
 * no longer is the ranking is vetoed (the admin's lever, M7). Ranks the chain shows paid are left out. The server holds no key.
 */
@QueryHandler(GetPayoutTransactionsQuery)
export class GetPayoutTransactionsHandler implements IQueryHandler<GetPayoutTransactionsQuery, PayoutTransactionsDto> {
  constructor(
    private readonly pools: PoolRepositoryPort,
    private readonly rides: RideQueryPort,
    private readonly chain: PoolChainPort,
    private readonly rules: RulesConfigPort,
    private readonly clock: ClockPort,
    private readonly hasher: HasherPort,
    @Optional() private readonly referralPayout?: ReferralPayoutService,
  ) {}

  async execute({ wallet, poolId }: GetPayoutTransactionsQuery): Promise<PayoutTransactionsDto> {
    if (!this.rules.get().treasury || wallet !== this.rules.get().treasury) throw new ForbiddenError('payouts are signed by the pool authority only', 'not_admin');
    const pool = await this.pools.findById(poolId);
    if (!pool) throw new NotFoundError('no such pool');
    if (!pool.isActive) throw new ConflictError(`this pool is ${pool.status} – only a live pool pays prizes`, 'not_payable');
    const now = this.clock.now().getTime();
    if (now < pool.playDeadline.getTime()) throw new ConflictError('the winners are committed once the rides are over (the play deadline)', 'too_early');
    if (pool.hold) throw new ConflictError(`the payout of this pool is on hold (${pool.hold.note ?? pool.hold.by})`, 'held');   // the same gates as the payout job (WP2 review)
    if ((await this.rides.poolUnreviewed(poolId, 1)).length) throw new ConflictError('a ride of this pool waits for an admin\'s decision', 'waiting_review');
    const chain = await this.chain.readPool(poolId);
    if (!chain) throw new NotFoundError(`pool ${poolId} is not on chain`);
    const s = pool.snapshot();
    const maxPlayerShareBps = s.maxPlayerShareBps ?? chain.maxPlayerShareBps;
    const prizeLamports = prizeBound({ priceLamports: s.priceLamports, ticketsSold: s.ticketsSold, sponsored: s.sponsored, prizeBps: s.prizeBps, seedBps: s.seedBps, ...(maxPlayerShareBps !== undefined ? { maxPlayerShareBps } : {}) });
    const ranking = await this.rides.poolRanking(poolId, TOP20_SIZE, true); // verified recordings only – money never follows shadow mode
    const plan = this.referralPayout
      ? await this.referralPayout.leaves(Pool.restore({ ...s, ...(maxPlayerShareBps !== undefined ? { maxPlayerShareBps } : {}) }))
      : poolPayouts(prizeLamports, ranking.map((r) => r.wallet)).filter((p) => p.lamports > 0).map((p) => ({ ...p, kind: 'rider' as const }));
    const tree = winnersTree(poolId, plan.map((p) => ({ wallet: p.wallet, lamports: p.lamports })), (d) => this.hasher.sha256(d));
    const paidBit = (rank: number) => chain.paidMask !== undefined && ((chain.paidMask >> BigInt(rank - 1)) & 1n) === 1n;
    const riderLeaves = plan.filter((p) => (p.kind ?? 'rider') === 'rider');
    const ranks = riderLeaves.map((p) => {
      const row = ranking.find((r) => r.wallet === p.wallet);
      return { rank: p.rank, wallet: p.wallet, distance: Math.round(row?.distance ?? 0), rides: row?.rides ?? 0, lamports: p.lamports, paid: paidBit(p.rank) };
    });
    const sign = (t: SignableTxDto): SignableTxDto => ({ transaction: t.transaction, message: t.message, lastValidBlockHeight: t.lastValidBlockHeight });
    const out: PayoutTransactionsDto = { poolId, prizeLamports, ranks, committedRoot: chain.winnersRoot ?? null, payFrom: chain.payFrom?.getTime() ?? null, commit: null, veto: null, transactions: [], close: null, note: null };
    if (!chain.winnersRoot) {
      out.commit = sign(await this.chain.buildCommitWinnersTransaction({ authority: wallet, poolId, root: tree.root, total: tree.total, count: plan.length }));
      out.note = plan.length ? 'commit the winners: they are public until the lock ends, then each rank is paid' : 'no verified ride ranks: committing no winner lets the pool close (the prize share goes to the seed treasury)';
      return out;
    }
    const nonePaid = chain.paidMask === undefined || chain.paidMask === 0n;
    if (nonePaid) out.veto = sign(await this.chain.buildVetoWinnersTransaction({ authority: wallet, poolId }));
    if (chain.winnersRoot !== tree.root.toString('base64')) {
      out.note = nonePaid ? 'the committed winners are not the ranking any more – veto them, then commit the ranking' : 'the committed winners are not the ranking any more and a rank is paid – they can no longer be vetoed';
      return out;
    }
    if (now < (chain.payFrom?.getTime() ?? 0)) {
      out.note = `the winners are public until ${chain.payFrom!.toISOString()} – prizes pay from then`;
      return out;
    }
    for (const r of plan.map((p, i) => ({ ...p, rank: i + 1 })).filter((p) => !paidBit(p.rank))) {
      const tx = await this.chain.buildPayPrizeTransaction({ payer: wallet, poolId, rank: r.rank, to: r.wallet, lamports: r.lamports, proof: tree.proofs[r.rank - 1]! });
      out.transactions.push({ rank: r.rank, to: r.wallet, lamports: r.lamports, transaction: tx.transaction, message: tx.message, lastValidBlockHeight: tx.lastValidBlockHeight });
    }
    if (!out.transactions.length) out.close = sign(await this.chain.buildClosePoolTransaction({ authority: wallet, poolId }));
    return out;
  }
}
