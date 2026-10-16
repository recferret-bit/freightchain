import { Logger } from '@nestjs/common';
import { CommandBus, CommandHandler, type ICommandHandler } from '@nestjs/cqrs';
import { SETTLE_GRACE_MS } from '../../../../domain/economy/pool-crank.js';
import type { Pool } from '../../../../domain/economy/pool.entity.js';
import type { PayoutState } from '../../../../domain/economy/pool.types.js';
import { poolPayouts, TOP20_SIZE } from '../../../../domain/economy/pool-payouts.js';
import type { PoolPayoutRecord } from '../../../../domain/economy/pool-payout.js';
import { prizeBound } from '../../../../domain/economy/vault-split.js';
import { winnersTree, type WinnersTree } from '../../../../domain/economy/winners-merkle.js';
import type { PoolChainState } from '../../../../domain/economy/chain-events.js';
import { DomainError } from '../../../../domain/shared/errors.js';
import { PoolChainPort } from '../../../ports/economy/pool-chain.port.js';
import { PoolPayoutChainPort } from '../../../ports/economy/pool-payout-chain.port.js';
import { PoolPayoutRepositoryPort } from '../../../ports/economy/pool-payout.repository.port.js';
import { PoolRepositoryPort } from '../../../ports/economy/pool.repository.port.js';
import { PledgeRepositoryPort } from '../../../ports/economy/pledge.repository.port.js';
import { RideQueryPort } from '../../../ports/rides/ride-query.port.js';
import { ClockPort } from '../../../ports/shared/clock.port.js';
import { HasherPort } from '../../../ports/shared/hasher.port.js';
import { PoolAttentionService } from '../../../services/pool-attention.service.js';
import { PoolRegistryService } from '../../../services/pool-registry.service.js';
import { AttestationService } from '../../../services/attestation.service.js';
import { SettleChainSignatureCommand } from '../settle-chain-signature/settle-chain-signature.command.js';
import { PayPoolsCommand, type PaidPrizeDto, type PayoutPassDto, type PoolPayoutResultDto } from './pay-pools.command.js';

/** states that wait for a person: the pool's settle grace runs on, so they are logged as an error when it is near */
const NEEDS_A_PERSON: readonly PayoutState[] = ['held', 'waiting_review', 'no_winners', 'error'];
/** the program refuses a commit whose lock ends later than this before the settle grace (COMMIT_GRACE_MARGIN_SECS, constants.rs) */
const COMMIT_GRACE_MARGIN_MS = 86_400_000;
/** warn this long before the settle grace ends (after it, the crank expires an unpaid pool into refunds) */
const GRACE_WARNING_MS = 3 * 86_400_000;
/** unreviewed rides read per pool (the count is what matters) */
const UNREVIEWED_LIMIT = 100;

/**
 * The payout job (docs/escrow-open-items.md, programs/freightchain-pools "Payout key"; program v4 – audit H5-B): for every ACTIVE pool whose rides are over
 * (`playDeadline`, by the CHAIN clock), unless an admin holds it:
 *   1. the pool-level checks run first (PoolAttentionService.markPool: a distance outlier, two ranked wallets on one IP, a brand-new wallet in the top 3 – each
 *      puts its ride back under review); then every completed ride of the pool must have been decided – a verified verdict, or an admin's decision. One ride
 *      still flagged, machine-rejected or unjudged blocks the whole pool (`waiting_review`): a ride an admin has not looked at might deserve a rank.
 *   2. the plan: the pool's ranking over VERIFIED rides only (whatever VERDICT_ENFORCE says – shadow mode is for the public boards, never for money), divided
 *      with pool-payouts.ts, written once (PoolPayout rows). No verified ride = `no_winners`: the admin decides.
 *   3. every pledged ride is attested (its RideAttestation – the pledges settle on it), then the plan is COMMITTED as a Merkle root (`commit_winners`): public until
 *      the pool's `payFrom` (the review lock) – `committed`. A ranking that moves after the commit stops the pool (`error`): the cold admin vetoes the root (admin
 *      page), and with the root gone and nothing paid the job plans and commits again.
 *   4. from `payFrom` every planned prize is CLAIMED (planned → sent, with its signature) before its `pay_prize` (with its proof) goes out, then paid and settled;
 *      a prize left `sent` by a crash is resolved from its signature (landed → paid, expired → planned again). A rank the chain already shows paid is not paid twice.
 *   5. all paid → close_pool with the payout key (money only to the pool's declared treasuries) → `paid`.
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
    private readonly registry: PoolRegistryService,
    private readonly attention: PoolAttentionService,
    private readonly commands: CommandBus,
    private readonly clock: ClockPort,
    private readonly attestation: AttestationService,
    private readonly pledges: PledgeRepositoryPort,
    private readonly hasher: HasherPort,
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
      if (now.getTime() < pool.playDeadline.getTime()) return await done(pool, 'pending', null);
      if (pool.hold) return await done(pool, 'held', pool.hold.note ?? `held by ${pool.hold.by}`);

      let rows = await this.payouts.listByPool(pool.id);
      if (!rows.length) await this.attention.markPool(pool.id); // before the plan only: once written, the plan is what gets committed
      const unreviewed = await this.rides.poolUnreviewed(pool.id, UNREVIEWED_LIMIT);   // EVERY pass, plan or not (audit M7): a ride put under review after the plan stops the money too
      if (unreviewed.length) {
        const n = unreviewed.length >= UNREVIEWED_LIMIT ? `${UNREVIEWED_LIMIT}+` : String(unreviewed.length);
        return await done(pool, 'waiting_review', `${n} ride(s) of this pool wait for an admin's decision`);
      }
      let chain = await this.chainState(pool.id);
      if (rows.some((r) => r.status !== 'paid')) {
        const drift = await this.planDrift(pool, rows);
        if (drift && chain.winnersRoot) return await done(pool, 'error', `${drift} – the admin vetoes the committed winners (admin page), then the job commits again`);
        // no root on chain (vetoed, or it never landed) and nothing paid: the one case the plan is written again
        if (drift && !(await this.payouts.discardPlan(pool.id))) return await done(pool, 'error', drift);   // decided 2026-10-14: a partly paid plan stops for the admin
        if (drift) rows = [];
      }
      if (!rows.length) {
        rows = await this.plan(pool);
        if (!rows.length) {
          const attested = await this.attestPledged(pool);
          if (attested) return await done(pool, attested.state, attested.note);
          return await done(pool, 'no_winners', 'no verified ride ranks in this pool – the admin decides: commit no winner and close it (the prize share goes to the seed treasury) or let it expire into refunds');
        }
      }
      const tree = this.treeOf(pool.id, rows);
      if (!chain.winnersRoot) {
        const held = await this.heldNow(pool.id);
        if (held) return await done(pool, 'held', held);
        const attested = await this.attestPledged(pool);   // before the commit: a pledged ride's lock then ends with the winners'
        if (attested) return await done(pool, attested.state, attested.note);
        const committed = await this.commit(pool, tree, rows.length, now);
        if (committed) return await done(pool, 'error', committed);
        chain = await this.chainState(pool.id);
      }
      if (chain.winnersRoot !== tree.root.toString('base64')) return await done(pool, 'error', 'the committed winners root is not this plan – the admin vetoes it (admin page), then the job commits the plan');
      const payFrom = chain.payFrom ?? pool.payoutAt;
      if (now.getTime() < payFrom.getTime()) return await done(pool, 'committed', `the winners are public until ${payFrom.toISOString()} – prizes pay from then`);

      for (const row of rows) {
        if (row.status === 'paid') continue;
        // anyone may pay a committed rank: already done on chain. Only a PLANNED row – a `sent` one is ours, resolved from its signature in payRow (and settled)
        if (row.status === 'planned' && chain.paidMask !== undefined && (chain.paidMask >> BigInt(row.rank - 1)) & 1n) {
          await this.payouts.markPaidElsewhere(pool.id, row.rank, this.clock.now());
          continue;
        }
        const { outcome, note } = await this.payRow(pool, row, tree, paid);
        if (outcome !== 'paid') return await done(pool, outcome === 'error' ? 'error' : outcome === 'held' ? 'held' : 'paying', note);
      }
      const holdBefore = await this.heldNow(pool.id);
      if (holdBefore) return await done(pool, 'held', holdBefore);   // a HOLD stops the attestations and the close too (L11)
      const attested = await this.attestPledged(pool);   // a verdict decided since the commit: the program refuses a record after the close
      if (attested) return await done(pool, attested.state, attested.note);
      const holdAtClose = await this.heldNow(pool.id);   // read again right before the close: a HOLD acknowledged before this point stops it
      if (holdAtClose) return await done(pool, 'held', holdAtClose);
      const { signature } = await this.payout.closePool(pool.id);
      await this.settle(signature);
      return await done(pool, 'paid', null, signature);
    } catch (error) {
      return await done(pool, 'error', error instanceof Error ? error.message : String(error));
    }
  }

  /** the Pool account as the chain holds it now (the committed root, its lock, the paid ranks – read every pass, never trusted from the mirror) */
  private async chainState(poolId: number): Promise<PoolChainState> {
    const state = await this.chain.readPool(poolId);
    if (!state) throw new Error(`pool ${poolId} is not on chain`);
    return state;
  }

  /** the plan as the program's winners tree: leaf index = rank − 1 */
  private treeOf(poolId: number, rows: readonly PoolPayoutRecord[]): WinnersTree {
    return winnersTree(poolId, [...rows].sort((a, b) => a.rank - b.rank).map((r) => ({ wallet: r.wallet, lamports: r.lamports })), (d) => this.hasher.sha256(d));
  }

  /** `commit_winners`; null = committed (or already there – the next read decides), else why not. Rule f: a commit whose lock would end too close to the grace is refused. */
  private async commit(pool: Pool, tree: WinnersTree, count: number, now: Date): Promise<string | null> {
    const graceEnd = pool.payoutAt.getTime() + SETTLE_GRACE_MS, lock = Math.max(0, pool.payoutAt.getTime() - pool.playDeadline.getTime());   // at least the review window
    if (now.getTime() + lock > graceEnd - COMMIT_GRACE_MARGIN_MS) return 'too late to commit the winners (the settle grace is near) – the admin decides: let the pool expire into refunds';   // the chain clock, like the program's
    try {
      const { signature } = await this.payout.commitWinners({ poolId: pool.id, root: tree.root, total: tree.total, count });
      await this.settle(signature);
      return null;
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      if (/WinnersCommitted/.test(message)) return null;   // another pass (or the admin) committed first: the chain read that follows compares the root
      return `commit_winners: ${message}`;
    }
  }

  /** the attestation of every ride with an active pledge in the pool (program v4: per RIDE, H4); the commit / close wait for the next pass while one is not decided
      (`waiting_review`) or failed (`error` – an RPC outage is not a review); null = all done (the program refuses a record after the close) */
  private async attestPledged(pool: Pool): Promise<{ state: 'waiting_review' | 'error'; note: string } | null> {
    const rides = [...new Set((await this.pledges.listActiveByPool(pool.id)).map((p) => p.rideId))];
    for (const rideId of rides) {
      try {
        const r = await this.attestation.attestRide(pool.id, rideId);
        if (r.status === 'undecided') return { state: 'waiting_review', note: `pledged ride ${rideId} is not decided yet – its attestation waits` };
      } catch (e) {
        return { state: 'error', note: `attestation of pledged ride ${rideId} failed: ${e instanceof Error ? e.message : String(e)}` };
      }
    }
    return null;
  }

  /** The admin's HOLD as stored NOW (audit L11: the job read it once per pass, so a HOLD acknowledged mid-pass did not stop the prizes after it). null = not held. */
  private async heldNow(poolId: number): Promise<string | null> {
    const p = await this.pools.findById(poolId);
    return p?.hold ? (p.hold.note ?? `held by ${p.hold.by}`) : null;
  }

  /** The unpaid plan against the verified ranking NOW (audit M7): a verdict decided after the plan (a ride rejected, another accepted) changes who should be
      paid – stop, with what moved, for the admin. null = the plan still is the ranking. */
  private async planDrift(pool: Pool, rows: readonly PoolPayoutRecord[]): Promise<string | null> {
    const now = (await this.rides.poolRanking(pool.id, TOP20_SIZE, true)).map((r) => r.wallet);
    const planned = [...rows].sort((a, b) => a.rank - b.rank).map((r) => r.wallet);
    if (now.length === planned.length && now.every((w, i) => w === planned[i])) return null;
    const first = planned.findIndex((w, i) => now[i] !== w);
    const at = first >= 0 ? first : planned.length;
    return `the verified ranking changed after the payout plan was written (rank ${at + 1}: planned ${planned[at] ?? '–'}, now ${now[at] ?? '–'}) – an admin decides; nothing more is paid until then`;
  }

  /** the plan from the verified ranking; written once (rows that exist are kept) */
  private async plan(pool: Pool): Promise<PoolPayoutRecord[]> {
    const ranking = await this.rides.poolRanking(pool.id, TOP20_SIZE, true);
    if (!ranking.length) return [];
    const s = pool.snapshot();
    const prize = prizeBound({ priceLamports: s.priceLamports, ticketsSold: s.ticketsSold, sponsored: s.sponsored, prizeBps: s.prizeBps, seedBps: s.seedBps });
    // a 0-lamport rank could never be paid (the program refuses it) and would keep the pool from closing: the shares are floored, so they are the last ranks
    const plan = poolPayouts(prize, ranking.map((r) => r.wallet)).filter((p) => p.lamports > 0).map((p) => ({ poolId: pool.id, rank: p.rank, wallet: p.wallet, lamports: p.lamports, status: 'planned' as const }));
    await this.payouts.plan(plan, this.clock.now());
    return this.payouts.listByPool(pool.id);
  }

  /** one prize: 'paid' = go on to the next; 'wait' = a transaction is in flight (or another pass has it); 'error' = stop and say why */
  private async payRow(pool: Pool, row: PoolPayoutRecord, tree: WinnersTree, paid: PaidPrizeDto[]): Promise<{ outcome: 'paid' | 'wait' | 'error' | 'held'; note: string | null }> {
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
    let claimed: string | null = null;
    try {
      const proof = tree.proofs[row.rank - 1] ?? [];
      const { signature } = await this.payout.payPrize({ poolId: pool.id, rank: row.rank, to: row.wallet, lamports: row.lamports, proof }, async (tx) => {
        // conditional on "not held" in the same statement: a HOLD acknowledged before this claim stops it (nothing is broadcast), one after it lets this prize go
        const claim = await this.payouts.claimSentUnlessHeld(pool.id, row.rank, tx.signature, tx.lastValidBlockHeight, this.clock.now());
        if (claim === 'held') throw new HeldAtClaim();
        if (claim === 'lost') throw new ClaimLost();
        claimed = tx.signature;
      });
      await this.payouts.markPaid(pool.id, row.rank, signature, this.clock.now());
      await this.settle(signature);
      paid.push({ rank: row.rank, wallet: row.wallet, lamports: row.lamports, signature });
      return ok;
    } catch (error) {
      if (error instanceof ClaimLost) return { outcome: 'wait', note: `another payout pass is paying rank ${row.rank}` };
      if (error instanceof HeldAtClaim) return { outcome: 'held', note: `held before rank ${row.rank} was paid` };
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
/** an admin's HOLD came first: the claim was not made, nothing was broadcast */
class HeldAtClaim extends Error {}
