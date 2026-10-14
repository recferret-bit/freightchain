import { Logger } from '@nestjs/common';
import { CommandHandler, type ICommandHandler } from '@nestjs/cqrs';
import { SETTLE_GRACE_MS } from '../../../../domain/economy/pool-crank.js';
import type { Pledge } from '../../../../domain/economy/pledge.entity.js';
import type { PledgeChainEvent } from '../../../../domain/economy/pledge.types.js';
import { PledgeRepositoryPort } from '../../../ports/economy/pledge.repository.port.js';
import { PoolChainPort } from '../../../ports/economy/pool-chain.port.js';
import { ATTESTATION_FLAGGED, ATTESTATION_VERIFIED, PoolPayoutChainPort } from '../../../ports/economy/pool-payout-chain.port.js';
import { PoolRepositoryPort } from '../../../ports/economy/pool.repository.port.js';
import { PlayerRepositoryPort } from '../../../ports/players/player.repository.port.js';
import { ClockPort } from '../../../ports/shared/clock.port.js';
import { TransactionPort } from '../../../ports/shared/transaction.port.js';
import { SyncPledgesCommand, type PledgeSyncDto } from './sync-pledges.command.js';
import { AttestationService } from '../../../services/attestation.service.js';

/** a create_pledge never signed: give up on the row after this long with no account on chain (the built transaction expired long before) */
const ABANDON_AFTER_MS = 60 * 60_000;

/**
 * The pledge job (after every payout pass): the rows follow the chain, and the payout key ends what can be ended.
 *   1. every pending / active pledge is read back from its account's own transactions (create, and a settle / refund anyone may have sent) – the chain is the truth;
 *   2. an active pledge whose driver has a decided attestation (the payout job records one for every pledged driver before it closes the pool) → settle_pledge;
 *   3. an active pledge of a pool that is over (failed, cancelled, closed, or past its settle grace) with no decided attestation → refund_pledge.
 * Both are permissionless on chain; the payout key only pays the fee. A failure is noted and retried next pass.
 */
@CommandHandler(SyncPledgesCommand)
export class SyncPledgesHandler implements ICommandHandler<SyncPledgesCommand, PledgeSyncDto> {
  private readonly log = new Logger(SyncPledgesHandler.name);

  constructor(
    private readonly pledges: PledgeRepositoryPort,
    private readonly chain: PoolChainPort,
    private readonly payout: PoolPayoutChainPort,
    private readonly pools: PoolRepositoryPort,
    private readonly players: PlayerRepositoryPort,
    private readonly transactions: TransactionPort,
    private readonly clock: ClockPort,
    private readonly attestation: AttestationService,
  ) {}

  async execute(): Promise<PledgeSyncDto> {
    const sending = this.payout.address !== null;
    const out: PledgeSyncDto = { sending, checked: 0, activated: 0, settled: 0, refunded: 0, abandoned: 0, errors: [] };
    for (const open of await this.pledges.listOpen()) {
      out.checked++;
      try {
        let p = await this.follow(open);
        if (p.status === 'active' && sending) p = await this.end(p);
        if (open.status === 'pending' && p.status !== 'pending') out.activated += p.status === 'abandoned' ? 0 : 1;
        if (p.status === 'abandoned' && open.status !== 'abandoned') out.abandoned++;
        if (p.status === 'settled') out.settled++;
        if (p.status === 'refunded') out.refunded++;
      } catch (e) {
        out.errors.push({ pledgeId: open.id, note: e instanceof Error ? e.message : String(e) });
      }
    }
    if (out.activated || out.settled || out.refunded || out.abandoned || out.errors.length) {
      this.log.log({ event: 'pledges', msg: `pledges: ${out.activated} active, ${out.settled} settled, ${out.refunded} refunded, ${out.abandoned} abandoned, ${out.errors.length} error(s)`, ...out });
    }
    return out;
  }

  /** the account's transactions, oldest first, applied to the row */
  private async follow(p: Pledge): Promise<Pledge> {
    const signatures = (await this.chain.pledgeSignatures(p.pdaAddress)).reverse();
    const events: PledgeChainEvent[] = [];
    for (const s of signatures) {
      const evs = await this.chain.readPledgeEvents(s);
      if (Array.isArray(evs)) events.push(...evs.filter((e) => p.matches(e)));
    }
    const abandon = !events.length && p.status === 'pending' && this.clock.now().getTime() - p.createdAt.getTime() > ABANDON_AFTER_MS;
    return events.length || abandon ? this.save(p.id, (row) => abandon ? (row.abandon(), true) : events.reduce((ch, e) => row.apply(e, this.clock.now()) || ch, false)) : p;
  }

  /** settle when the driver is attested, refund when the pool is over without one, else wait */
  private async end(p: Pledge): Promise<Pledge> {
    const keys = { poolId: p.poolId, rideId: p.rideId, sponsor: p.sponsor, driver: p.driver };
    const live = await this.pools.findById(p.poolId);
    // money the admin has not released waits (WP2 review): a held pool, one with rides under review, one stopped in error
    if (live?.isActive && (live.hold || ['held', 'waiting_review', 'error'].includes(live.payoutState))) return p;
    // the attestation is read against the rides AGAIN while it can still be rewritten (pentest M7: a verdict revoked after it was written)
    const isDecided = (a: { status: number; verifiedKm: number } | null) => a !== null && ((a.status === ATTESTATION_VERIFIED && a.verifiedKm > 0) || a.status === ATTESTATION_FLAGGED);
    let att = await this.payout.attestationOf(p.poolId, p.driver);
    if (live?.isActive && isDecided(att)) { await this.attestation.attestForPledges(p.poolId, p.driver); att = await this.payout.attestationOf(p.poolId, p.driver); }   // only one it would settle on
    const decided = isDecided(att);
    let signature: string;
    if (decided) {
      signature = (await this.payout.settlePledge(keys)).signature;
    } else {
      const pool = await this.pools.findById(p.poolId);
      const now = this.clock.now().getTime();
      const over = pool !== null && (['refunding', 'cancelled', 'settled'].includes(pool.status) || (pool.isActive && now >= pool.payoutAt.getTime() + SETTLE_GRACE_MS));
      if (!over) return p;
      signature = (await this.payout.refundPledge(keys)).signature;
    }
    const evs = await this.chain.readPledgeEvents(signature);
    if (!Array.isArray(evs)) return p; // landed but not readable yet: the next pass follows it from the account's history
    return this.save(p.id, (row) => evs.filter((e) => row.matches(e)).reduce((ch, e) => row.apply(e, this.clock.now()) || ch, false));
  }

  /** re-read the row under the sponsor's player lock, change it, save it if it changed */
  private async save(id: string, change: (row: Pledge) => boolean): Promise<Pledge> {
    return this.transactions.run(async (tx) => {
      const first = await this.pledges.findById(id, tx);
      if (!first) throw new Error(`pledge ${id} vanished`);
      await this.players.findByWalletForUpdate(first.sponsor, tx);
      const row = (await this.pledges.findById(id, tx))!;
      if (change(row)) await this.pledges.save(row, tx);
      return row;
    });
  }
}
