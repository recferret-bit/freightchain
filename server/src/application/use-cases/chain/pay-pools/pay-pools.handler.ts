import { Logger } from '@nestjs/common';
import { CommandBus, CommandHandler, type ICommandHandler } from '@nestjs/cqrs';
import { SETTLE_GRACE_MS } from '../../../../domain/economy/pool-crank.js';
import type { Pool } from '../../../../domain/economy/pool.entity.js';
import type { PayoutState } from '../../../../domain/economy/pool.types.js';
import { poolPayouts, TOP20_SIZE } from '../../../../domain/economy/pool-payouts.js';
import type { PoolPayoutRecord } from '../../../../domain/economy/pool-payout.js';
import { prizeBound } from '../../../../domain/economy/vault-split.js';
import { DomainError } from '../../../../domain/shared/errors.js';
import { ChainEventRepositoryPort } from '../../../ports/economy/chain-event.repository.port.js';
import { PoolChainPort } from '../../../ports/economy/pool-chain.port.js';
import { PoolPayoutChainPort } from '../../../ports/economy/pool-payout-chain.port.js';
import { PoolPayoutRepositoryPort } from '../../../ports/economy/pool-payout.repository.port.js';
import { PoolRepositoryPort } from '../../../ports/economy/pool.repository.port.js';
import { RideQueryPort } from '../../../ports/rides/ride-query.port.js';
import { ClockPort } from '../../../ports/shared/clock.port.js';
import { PoolAttentionService } from '../../../services/pool-attention.service.js';
import { PoolRegistryService } from '../../../services/pool-registry.service.js';
import { AttestationService } from '../../../services/attestation.service.js';
import { SettleChainSignatureCommand } from '../settle-chain-signature/settle-chain-signature.command.js';
import { PayPoolsCommand, type PaidPrizeDto, type PayoutPassDto, type PoolPayoutResultDto } from './pay-pools.command.js';

/** states that wait for a person: the pool's settle grace runs on, so they are logged as an error when it is near */
const NEEDS_A_PERSON: readonly PayoutState[] = ['held', 'waiting_review', 'no_winners', 'error'];
/** warn this long before the settle grace ends (after it, the crank expires an unpaid pool into refunds) */
const GRACE_WARNING_MS = 3 * 86_400_000;
/** unreviewed rides read per pool (the count is what matters) */
const UNREVIEWED_LIMIT = 100;

/**
 * The payout job (docs/escrow-open-items.md, programs/freightchain-pools "Payout key"): for every ACTIVE pool whose review window is over (`payoutAt`, by the
 * CHAIN clock – the program checks it again), unless an admin holds it:
 *   1. the pool-level checks run first (PoolAttentionService.markPool: a distance outlier, two ranked wallets on one IP, a brand-new wallet in the top 3 – each
 *      puts its ride back under review); then every completed ride of the pool must have been decided – a verified verdict, or an admin's decision. One ride
 *      still flagged, machine-rejected or unjudged blocks the whole pool (`waiting_review`): a ride an admin has not looked at might deserve a rank.
 *   2. the plan: the pool's ranking over VERIFIED rides only (whatever VERDICT_ENFORCE says – shadow mode is for the public boards, never for money), divided
 *      with pool-payouts.ts, written once (PoolPayout rows). No verified ride = `no_winners`: the admin decides.
 *   3. every planned prize is CLAIMED (planned → sent, with its signature) before its transaction goes out, then paid and settled; a prize left `sent` by a crash is
 *      resolved from its signature (landed → paid, expired → planned again). A wallet the chain already shows paid is not paid twice.
 *   4. all paid → close_pool with the payout key (money only to the pool's declared treasuries) → `paid`.
 * Each signature is settled at once (SettleChainSignatureCommand), so the mirror follows without waiting for the watcher.
 */
@CommandHandler(PayPoolsCommand)
export class PayPoolsHandler implements ICommandHandler<PayPoolsCommand, PayoutPassDto> {
  private readonly log = new Logger(PayPoolsHandler.name);

  constructor(
    private readonly payout: PoolPayoutChainPort,
    private readonly chain: PoolChainPort,
    private readonly pools: PoolRepositoryPort,
    private readonly payouts: PoolPayoutRepositoryPort,
    private readonly rides: RideQueryPort,
    private readonly events: ChainEventRepositoryPort,
    private readonly registry: PoolRegistryService,
    private readonly attention: PoolAttentionService,
    private readonly commands: CommandBus,
    private readonly clock: ClockPort,
    private readonly attestation: AttestationService,
  ) {}

  async execute({ poolId }: PayPoolsCommand): Promise<PayoutPassDto> {
    const address = this.payout.address;
    if (!address) return { enabled: false, payout: null, refused: null, chainNow: null, pools: [] };
    const named = await this.payout.configuredPayoutAuthority();
    if (named !== address) {
      const refused = named ? `the program names ${named} as its payout key, not ${address}` : 'the program names no payout key yet (pool-admin.mjs set-payout-authority)';
      this.log.error({ event: 'payout', msg: `payout job off: ${refused}` });
      return { enabled: false, payout: address, refused, chainNow: null, pools: [] };
    }
    const now = await this.payout.chainNow();
    const work = poolId === null ? await this.pools.listPayable(now) : [await this.pools.findById(poolId)].filter((p): p is Pool => p !== null);
    const results: PoolPayoutResultDto[] = [];
    for (const pool of work) results.push(await this.payPool(pool, now));
    for (const r of results.filter((x) => x.paid.length || x.closed)) {
      this.log.log({ event: 'payout', msg: `pool ${r.poolId}: ${r.paid.length} prize(s) paid${r.closed ? ', closed' : ''} → ${r.state}`, poolId: r.poolId, state: r.state });
    }
    return { enabled: true, payout: address, refused: null, chainNow: now.getTime(), pools: results };
  }

  private async payPool(start: Pool, now: Date): Promise<PoolPayoutResultDto> {
    const paid: PaidPrizeDto[] = [];
    const done = async (pool: Pool, state: PayoutState, note: string | null, closed: string | null = null): Promise<PoolPayoutResultDto> => {
      if (pool.payoutState !== 'paid') await this.pools.savePayout(pool.id, state, note);
      if (NEEDS_A_PERSON.includes(state) && now.getTime() >= pool.payoutAt.getTime() + SETTLE_GRACE_MS - GRACE_WARNING_MS) {
        this.log.error({ event: 'payout-grace', msg: `pool ${pool.id} is ${state} and its settle grace ends ${new Date(pool.payoutAt.getTime() + SETTLE_GRACE_MS).toISOString()} – after it the crank refunds every ticket`, poolId: pool.id, state });
      }
      return { poolId: pool.id, state, note, paid, closed };
    };
    let pool = start;
    try {
      pool = (await this.registry.syncFromChain(start.id)) ?? start;
      if (pool.status === 'settled') return await done(pool, 'paid', null);
      if (!pool.isActive) return { poolId: pool.id, state: pool.payoutState, note: `the pool is ${pool.status}`, paid, closed: null };
      if (now.getTime() < pool.payoutAt.getTime()) return await done(pool, 'pending', null);
      if (pool.hold) return await done(pool, 'held', pool.hold.note ?? `held by ${pool.hold.by}`);

      let rows = await this.payouts.listByPool(pool.id);
      if (!rows.length) await this.attention.markPool(pool.id); // before the plan only: once written, the plan is what gets paid
      const unreviewed = rows.length ? [] : await this.rides.poolUnreviewed(pool.id, UNREVIEWED_LIMIT);
      if (unreviewed.length) {
        const n = unreviewed.length >= UNREVIEWED_LIMIT ? `${UNREVIEWED_LIMIT}+` : String(unreviewed.length);
        return await done(pool, 'waiting_review', `${n} ride(s) of this pool wait for an admin's decision`);
      }

      if (!rows.length) {
        rows = await this.plan(pool);
        if (!rows.length) return await done(pool, 'no_winners', 'no verified ride ranks in this pool – the admin decides: close it by hand (the prize share goes to the seed treasury) or let it expire into refunds');
      }
      const paidOnChain = await this.paidWallets(pool.id);
      for (const row of rows) {
        if (row.status === 'paid') continue;
        const { outcome, note } = await this.payRow(pool, row, paidOnChain, paid);
        if (outcome !== 'paid') return await done(pool, outcome === 'error' ? 'error' : 'paying', note);
      }
      const { signature } = await this.payout.closePool(pool.id);
      await this.settle(signature);
      return await done(pool, 'paid', null, signature);
    } catch (error) {
      return await done(pool, 'error', error instanceof Error ? error.message : String(error));
    }
  }

  /** the plan from the verified ranking; written once (rows that exist are kept) */
  private async plan(pool: Pool): Promise<PoolPayoutRecord[]> {
    const ranking = await this.rides.poolRanking(pool.id, TOP20_SIZE, true);
    if (!ranking.length) return [];
    const s = pool.snapshot();
    const prize = prizeBound({ priceLamports: s.priceLamports, ticketsSold: s.ticketsSold, sponsored: s.sponsored, prizeBps: s.prizeBps, seedBps: s.seedBps });
    const paidOnChain = await this.paidWallets(pool.id);
    const plan = poolPayouts(prize, ranking.map((r) => r.wallet)).map((p) => ({ poolId: pool.id, rank: p.rank, wallet: p.wallet, lamports: p.lamports, status: paidOnChain.has(p.wallet) ? 'paid' as const : 'planned' as const }));
    await this.payouts.plan(plan, this.clock.now());
    return this.payouts.listByPool(pool.id);
  }

  /** wallets the chain already shows a PrizePaid for in this pool (the mirror's event log – every one, not a window of recent events) */
  private async paidWallets(poolId: number): Promise<Set<string>> {
    return new Set(await this.events.prizeWalletsOfPool(poolId));
  }

  /** one prize: 'paid' = go on to the next; 'wait' = a transaction is in flight (or another pass has it); 'error' = stop and say why */
  private async payRow(pool: Pool, row: PoolPayoutRecord, paidOnChain: Set<string>, paid: PaidPrizeDto[]): Promise<{ outcome: 'paid' | 'wait' | 'error'; note: string | null }> {
    const ok = { outcome: 'paid' as const, note: null };
    if (row.status === 'sent' && row.signature) {
      // a confirmed STATUS is not enough: a transaction that landed but FAILED is confirmed too. Paid = the transaction's own events show this prize.
      const status = await this.chain.signatureStatus(row.signature, row.lastValidBlockHeight ?? 0);
      if (status === 'expired') {
        await this.payouts.release(pool.id, row.rank, row.signature, 'the transaction expired without landing – sent again', this.clock.now());
      } else {
        const events = status === 'confirmed' || status === 'finalized' ? await this.chain.readEvents(row.signature) : 'pending';
        if (Array.isArray(events) && events.some((e) => e.kind === 'PrizePaid' && e.to === row.wallet && e.lamports === row.lamports)) {
          await this.payouts.markPaid(pool.id, row.rank, row.signature, this.clock.now());
          await this.settle(row.signature);
          return ok;
        }
        if (events === 'pending') return { outcome: 'wait', note: `waiting for the prize of rank ${row.rank} (${row.signature}) to land` };
        // landed without paying this prize (failed on chain – atomic, nothing moved): back to planned, a new transaction pays it
        await this.payouts.release(pool.id, row.rank, row.signature, `the transaction landed without paying: ${Array.isArray(events) ? 'no PrizePaid' : events.invalid}`, this.clock.now());
      }
    }
    if (paidOnChain.has(row.wallet)) {
      await this.payouts.markPaidElsewhere(pool.id, row.rank, this.clock.now());
      return ok;
    }
    try {
      await this.attestation.ensureAttestation(pool.id, row.wallet);
    } catch (attestError) {
      const msg = attestError instanceof Error ? attestError.message : String(attestError);
      return { outcome: 'error', note: `attestation failed for ${row.wallet}: ${msg}` };
    }
    let claimed: string | null = null;
    try {
      const { signature } = await this.payout.payPrize({ poolId: pool.id, to: row.wallet, lamports: row.lamports, rank: row.rank }, async (tx) => {
        if (!(await this.payouts.claimSent(pool.id, row.rank, tx.signature, tx.lastValidBlockHeight, this.clock.now()))) throw new ClaimLost();
        claimed = tx.signature;
      });
      await this.payouts.markPaid(pool.id, row.rank, signature, this.clock.now());
      await this.settle(signature);
      paid.push({ rank: row.rank, wallet: row.wallet, lamports: row.lamports, signature });
      return ok;
    } catch (error) {
      if (error instanceof ClaimLost) return { outcome: 'wait', note: `another payout pass is paying rank ${row.rank}` };
      const message = error instanceof Error ? error.message : String(error);
      const code = error instanceof DomainError ? error.errorCode : null;
      if (claimed && (code === 'transaction_dropped' || code === 'transaction_failed')) { // never landed / failed on chain (atomic: nothing moved) – back to planned, the next pass signs a new one
        await this.payouts.release(pool.id, row.rank, claimed, message, this.clock.now());
        return { outcome: 'wait', note: message };
      }
      if (claimed) return { outcome: 'wait', note: message }; // unconfirmed / an RPC hiccup after the broadcast: resolved from the signature next pass
      await this.payouts.noteError(pool.id, row.rank, message, this.clock.now());
      return { outcome: 'error', note: `rank ${row.rank}: ${message}` };
    }
  }

  /** settle one signature into the mirror now; false = it failed (the watcher settles it later – the chain is the truth either way) */
  private async settle(signature: string): Promise<boolean> {
    try {
      await this.commands.execute(new SettleChainSignatureCommand(signature));
      return true;
    } catch (e) {
      this.log.warn(`settle ${signature}: ${(e as Error).message} – the watcher settles it`);
      return false;
    }
  }
}

/** the conditional claim of a prize lost to another pass: nothing was broadcast */
class ClaimLost extends Error {}
