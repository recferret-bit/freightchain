import { Injectable } from '@nestjs/common';
import type { Pool } from '../../domain/economy/pool.entity.js';
import { toTicketBalanceDto, type TicketBalanceDto } from '../../domain/economy/prize-pool.dto.js';
import type { TicketSource } from '../../domain/players/ride-ticket.types.js';
import type { PaidTierId } from '../../domain/rides/ride-tier.js';
import { ConflictError } from '../../domain/shared/errors.js';
import { PoolRepositoryPort } from '../ports/economy/pool.repository.port.js';
import { RideTicketRepositoryPort } from '../ports/players/ride-ticket.repository.port.js';
import type { TransactionHandle } from '../ports/shared/transaction.port.js';

/**
 * A wallet's tickets across the pools. `spendForRide` and `grant` change a balance: the caller runs them inside ITS transaction while holding the wallet's
 * player row lock (`findByWalletForUpdate`) – that lock is what makes "one ticket, one ride" hold under parallel requests.
 */
@Injectable()
export class PoolTicketsService {
  constructor(
    private readonly pools: PoolRepositoryPort,
    private readonly tickets: RideTicketRepositoryPort,
  ) {}

  /** What /api/me and /api/profile list: pools the wallet holds tickets in, live pools it has a row in, and failed pools it paid into (refundable – also an open
      pool past its deadline under its minimum, `now` = the request's clock). */
  async balances(wallet: string, now: Date, tx?: TransactionHandle): Promise<TicketBalanceDto[]> {
    const rows = await this.tickets.listByWallet(wallet, tx);
    const pools = new Map((await this.pools.findMany(rows.map((t) => t.poolId), tx)).map((p) => [p.id, p]));
    return rows.flatMap((t) => {
      const pool = pools.get(t.poolId);
      if (!pool) return [];
      const dto = toTicketBalanceDto(t, pool, now);
      return t.balance > 0 || dto.refundable || pool.status === 'open' || pool.status === 'active' ? [dto] : [];
    });
  }

  /** Does this tier sell through pools at all? (a registered open / active pool exists) – else the legacy pay-per-ride order still applies. */
  async tierHasPools(tier: PaidTierId, tx?: TransactionHandle): Promise<boolean> {
    return (await this.pools.listLiveOfTier(tier, tx)).length > 0;
  }

  /**
   * Spends one ticket of `tier` for the ride `rideId`: from the active pool (still before its play deadline) that ends soonest among those the wallet holds
   * tickets in – at a week boundary two pools of a tier overlap and the older tickets go first. 409 `pool_not_live` when the wallet's only tickets are in a
   * pool that has not reached its minimum yet, 409 `no_tickets` when it has none. Returns the pool the ride belongs to.
   */
  async spendForRide(wallet: string, tier: PaidTierId, rideId: string, now: Date, tx: TransactionHandle): Promise<Pool> {
    const pools = await this.pools.listLiveOfTier(tier, tx);
    let waiting: Pool | null = null;
    for (const pool of pools) {
      const ticket = await this.tickets.find(wallet, pool.id, tx);
      if (!ticket || ticket.balance <= 0) continue;
      if (pool.isActive && now.getTime() < pool.playDeadline.getTime()) {
        ticket.spend();
        await this.tickets.save(ticket, tx);
        await this.tickets.appendGrant({ wallet, poolId: pool.id, delta: -1, source: 'spend', ref: rideId, at: now }, tx);
        return pool;
      }
      if (pool.status === 'open') waiting ??= pool;
    }
    if (waiting) {
      const n = waiting.ticketsToGo;
      throw new ConflictError(`pool not live yet – ${n} more ticket${n === 1 ? '' : 's'} needed`, 'pool_not_live');
    }
    throw new ConflictError(`no ${tier} tickets left`, 'no_tickets');
  }

  /**
   * A free gift of `n` tickets into `pool` (promo code, admin), clamped so the wallet never holds more than the pool's per-wallet cap. Writes the audit line
   * (delta = what was really added) even when nothing fit, so a capped redemption is visible. Returns what was added and the new balance.
   */
  async grant(wallet: string, pool: Pool, n: number, source: Extract<TicketSource, 'promo' | 'admin'>, ref: string | null, now: Date, tx: TransactionHandle): Promise<{ added: number; balance: number }> {
    const ticket = await this.tickets.open(wallet, pool.id, tx);
    const added = ticket.grant(n, pool.maxPerWallet);
    const saved = added > 0 ? await this.tickets.save(ticket, tx) : ticket;
    await this.tickets.appendGrant({ wallet, poolId: pool.id, delta: added, source, ref, at: now }, tx);
    return { added, balance: saved.balance };
  }
}
