import { CommandHandler, type ICommandHandler } from '@nestjs/cqrs';
import type { Pool } from '../../../../domain/economy/pool.entity.js';
import { PromoCode } from '../../../../domain/economy/promo-code.entity.js';
import { ConflictError, NotFoundError } from '../../../../domain/shared/errors.js';
import { PoolRepositoryPort } from '../../../ports/economy/pool.repository.port.js';
import { PromoRepositoryPort } from '../../../ports/economy/promo.repository.port.js';
import { PlayerRepositoryPort } from '../../../ports/players/player.repository.port.js';
import { RideTicketRepositoryPort } from '../../../ports/players/ride-ticket.repository.port.js';
import { ClockPort } from '../../../ports/shared/clock.port.js';
import { TransactionPort, type TransactionHandle } from '../../../ports/shared/transaction.port.js';
import { PlayerSessionService } from '../../../services/player-session.service.js';
import { PoolTicketsService } from '../../../services/pool-tickets.service.js';
import { withVersionRetry } from '../../../services/version-retry.js';
import { RedeemPromoCommand, type PromoRedeemedDto } from './redeem-promo.command.js';

/**
 * Redeem a promo code: free tickets into a pool (an off-chain grant – it never counts towards the pool's on-chain minimum). One transaction under the wallet's
 * player lock. Everything that can refuse is checked BEFORE a redemption is taken, so a wallet already at the pool's cap does not burn one; the redemption
 * itself is one atomic UPDATE (two wallets never both get the last one) and the (code, wallet, n) key enforces the per-wallet limit.
 */
@CommandHandler(RedeemPromoCommand)
export class RedeemPromoHandler implements ICommandHandler<RedeemPromoCommand, PromoRedeemedDto> {
  constructor(
    private readonly players: PlayerRepositoryPort,
    private readonly promos: PromoRepositoryPort,
    private readonly pools: PoolRepositoryPort,
    private readonly tickets: RideTicketRepositoryPort,
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
      if (!(await this.players.findByWalletForUpdate(wallet, tx))) throw new NotFoundError('player not found');
      const promo = await this.promos.findByCode(code, tx);
      if (!promo) throw new NotFoundError('no such promo code');
      const used = await this.promos.countRedemptions(code, wallet, tx);
      const why = promo.whyNotRedeemable(now, used);
      if (why) throw new ConflictError(why, 'promo_unavailable');
      const pool = await this.targetPool(promo, now, tx);
      const held = (await this.tickets.find(wallet, pool.id, tx))?.balance ?? 0;
      if (held >= pool.maxPerWallet) throw new ConflictError(`you already hold the maximum of ${pool.maxPerWallet} tickets in this pool`, 'ticket_cap');
      if (!(await this.promos.takeRedemption(code, now, tx))) throw new ConflictError('this promo code has been fully redeemed', 'promo_unavailable');
      if (!(await this.promos.insertRedemption(code, wallet, used + 1, now, tx))) throw new ConflictError('you have already redeemed this promo code', 'promo_unavailable');
      const { added, balance } = await this.poolTickets.grant(wallet, pool, promo.credits, 'promo', code, now, tx);
      return { code, poolId: pool.id, tier: pool.tier, added, balance, cap: pool.maxPerWallet };
    }));
  }

  /** The pinned pool, or the live pool of the code's tier that is still selling and ends soonest. Either way it must still be open for entries. */
  private async targetPool(promo: PromoCode, now: Date, tx: TransactionHandle): Promise<Pool> {
    const candidates = promo.poolId !== null ? [await this.pools.findById(promo.poolId, tx)].filter((p): p is Pool => p !== null) : await this.pools.listLiveOfTier(promo.tier, tx);
    const pool = candidates.find((p) => p.whyNotSellable(now, 1, 0) === null);
    if (!pool) throw new ConflictError(promo.poolId !== null ? 'the pool of this promo code is no longer open' : `no ${promo.tier} pool is open right now`, 'no_open_pool');
    return pool;
  }
}
