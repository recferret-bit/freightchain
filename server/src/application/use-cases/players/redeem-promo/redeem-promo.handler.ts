import { CommandHandler, type ICommandHandler } from '@nestjs/cqrs';
import type { Pool } from '../../../../domain/economy/pool.entity.js';
import { PromoCode } from '../../../../domain/economy/promo-code.entity.js';
import { describeEffect } from '../../../../domain/economy/promo.dto.js';
import type { PromoEffect } from '../../../../domain/economy/promo.types.js';
import type { Player } from '../../../../domain/players/player.entity.js';
import { ConflictError, NotFoundError } from '../../../../domain/shared/errors.js';
import { PoolRepositoryPort } from '../../../ports/economy/pool.repository.port.js';
import { PromoRepositoryPort } from '../../../ports/economy/promo.repository.port.js';
import { CosmeticRepositoryPort } from '../../../ports/players/cosmetic.repository.port.js';
import { PlayerRepositoryPort } from '../../../ports/players/player.repository.port.js';
import { RideTicketRepositoryPort } from '../../../ports/players/ride-ticket.repository.port.js';
import { ClockPort } from '../../../ports/shared/clock.port.js';
import { TransactionPort, type TransactionHandle } from '../../../ports/shared/transaction.port.js';
import { PlayerSessionService } from '../../../services/player-session.service.js';
import { PoolTicketsService } from '../../../services/pool-tickets.service.js';
import { withVersionRetry } from '../../../services/version-retry.js';
import { RedeemPromoCommand, type PromoRedeemedDto } from './redeem-promo.command.js';

/**
 * Redeem a promo code – one transaction under the wallet's player lock, whatever the effect: free tickets into a pool (an off-chain grant – it never counts towards
 * the pool's on-chain minimum), extra free rides, or a cosmetic unlocked + equipped. Everything that can refuse is checked BEFORE a redemption is taken, so a wallet
 * already at the pool's cap / already owning the cosmetic does not burn one; the redemption itself is one atomic UPDATE (two wallets never both get the last one,
 * nothing before `startsAt`) and the (code, wallet, n) key enforces the per-wallet limit.
 */
@CommandHandler(RedeemPromoCommand)
export class RedeemPromoHandler implements ICommandHandler<RedeemPromoCommand, PromoRedeemedDto> {
  constructor(
    private readonly players: PlayerRepositoryPort,
    private readonly promos: PromoRepositoryPort,
    private readonly pools: PoolRepositoryPort,
    private readonly tickets: RideTicketRepositoryPort,
    private readonly cosmetics: CosmeticRepositoryPort,
    private readonly poolTickets: PoolTicketsService,
    private readonly sessions: PlayerSessionService,
    private readonly transactions: TransactionPort,
    private readonly clock: ClockPort,
  ) {}

  async execute({ wallet, code: typed }: RedeemPromoCommand): Promise<PromoRedeemedDto> {
    const code = PromoCode.normalize(typed);
    if (!PromoCode.isValidCode(code)) throw new NotFoundError('no such promo code');
    await this.sessions.touch(wallet);
    return withVersionRetry(() => this.transactions.run(async (tx) => {
      const now = this.clock.now();
      const player = await this.players.findByWalletForUpdate(wallet, tx);
      if (!player) throw new NotFoundError('player not found');
      const promo = await this.promos.findByCode(code, tx);
      if (!promo) throw new NotFoundError('no such promo code');
      const used = await this.promos.countRedemptions(code, wallet, tx);
      const why = promo.whyNotRedeemable(now, used);
      if (why) throw new ConflictError(why, 'promo_unavailable');
      const e = promo.effect;
      const label = describeEffect(e);
      // refuse BEFORE burning a redemption; `apply` runs after it is taken
      const apply = await this.prepare(e, wallet, now, tx);
      if (!(await this.promos.takeRedemption(code, now, tx))) throw new ConflictError('this promo code has been fully redeemed', 'promo_unavailable');
      if (!(await this.promos.insertRedemption(code, wallet, used + 1, now, tx))) throw new ConflictError('you have already redeemed this promo code', 'promo_unavailable');
      return apply(player, code, label);
    }));
  }

  /** Checks what the effect needs and returns the step that grants it. */
  private async prepare(e: PromoEffect, wallet: string, now: Date, tx: TransactionHandle): Promise<(player: Player, code: string, label: string) => Promise<PromoRedeemedDto>> {
    if (e.kind === 'free_rides') {
      return async (player, code, label) => {
        player.grantFreeRides(e.count);
        await this.players.save(player, tx);
        return { kind: 'free_rides', code, label, added: e.count, freeRides: player.freeRides };
      };
    }
    if (e.kind === 'cosmetic') {
      if (await this.cosmetics.has(wallet, e.slot, e.item, tx)) throw new ConflictError('you already own this item', 'already_owned');
      return async (_player, code, label) => {
        await this.cosmetics.unlock({ wallet, slot: e.slot, item: e.item, code, at: now }, tx);
        await this.cosmetics.equip(wallet, e.slot, e.item, tx);
        return { kind: 'cosmetic', code, label, slot: e.slot, item: e.item };
      };
    }
    const pool = await this.targetPool(e, now, tx);
    const held = (await this.tickets.find(wallet, pool.id, tx))?.balance ?? 0;
    if (held >= pool.maxPerWallet) throw new ConflictError(`you already hold the maximum of ${pool.maxPerWallet} tickets in this pool`, 'ticket_cap');
    return async (_player, code, label) => {
      const { added, balance } = await this.poolTickets.grant(wallet, pool, e.credits, 'promo', code, now, tx);
      return { kind: 'tickets', code, label, poolId: pool.id, tier: pool.tier, added, balance, cap: pool.maxPerWallet };
    };
  }

  /** The pinned pool, or the live pool of the code's tier that is still selling and ends soonest. Either way it must still be open for entries. */
  private async targetPool(e: Extract<PromoEffect, { kind: 'tickets' }>, now: Date, tx: TransactionHandle): Promise<Pool> {
    const candidates = e.poolId !== null ? [await this.pools.findById(e.poolId, tx)].filter((p): p is Pool => p !== null) : await this.pools.listLiveOfTier(e.tier, tx);
    const pool = candidates.find((p) => p.whyNotSellable(now, 1, 0) === null);
    if (!pool) throw new ConflictError(e.poolId !== null ? 'the pool of this promo code is no longer open' : `no ${e.tier} pool is open right now`, 'no_open_pool');
    return pool;
  }
}
