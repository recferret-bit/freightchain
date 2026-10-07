import { CommandHandler, type ICommandHandler } from '@nestjs/cqrs';
import { lamportsFor } from '../../../../domain/economy/prize-split.js';
import { toRideDto, type RideDto } from '../../../../domain/rides/ride.dto.js';
import { Ride } from '../../../../domain/rides/ride.entity.js';
import { RideStatus } from '../../../../domain/rides/ride-status.js';
import { isPaidTier, rideTier } from '../../../../domain/rides/ride-tier.js';
import { ConflictError, NotFoundError, ServiceUnavailableError } from '../../../../domain/shared/errors.js';
import { RulesConfigPort } from '../../../ports/config/rules-config.port.js';
import { PriceQuotePort, type PriceQuote } from '../../../ports/economy/price-quote.port.js';
import { PlayerRepositoryPort } from '../../../ports/players/player.repository.port.js';
import { RideRepositoryPort } from '../../../ports/rides/ride.repository.port.js';
import { ClockPort } from '../../../ports/shared/clock.port.js';
import { EntropyPort } from '../../../ports/shared/entropy.port.js';
import { TransactionPort } from '../../../ports/shared/transaction.port.js';
import { PlayerSessionService } from '../../../services/player-session.service.js';
import { isDemoWallet, demoScaleOf } from '../../../services/demo.js';
import { CreateRideCommand } from './create-ride.command.js';

/**
 * Get the wallet a ride. A wallet has at most ONE ride in hand, and everything it does to its rides and free credits runs under a row lock on its player
 * (parallel requests queue up), so two parallel POSTs can neither create two rides nor spend one credit twice.
 *   running                → 409
 *   ready (created)        → the same ride back – a PAID one is never lost; an unstarted FREE one is cancelled (credit refunded) when a paid tier is bought
 *   awaiting payment       → the same order while its tier matches and the price is still held; otherwise it lapses (a late matching payment is still honoured)
 */
@CommandHandler(CreateRideCommand)
export class CreateRideHandler implements ICommandHandler<CreateRideCommand, RideDto> {
  constructor(
    private readonly players: PlayerRepositoryPort,
    private readonly rides: RideRepositoryPort,
    private readonly sessions: PlayerSessionService,
    private readonly price: PriceQuotePort,
    private readonly rules: RulesConfigPort,
    private readonly transactions: TransactionPort,
    private readonly clock: ClockPort,
    private readonly entropy: EntropyPort,
  ) {}

  async execute({ wallet, tier }: CreateRideCommand): Promise<RideDto> {
    const rules = this.rules.get();
    const paid = isPaidTier(tier);
    if (paid && !rules.treasury) throw new ServiceUnavailableError('paid rides are not configured on this server (no treasury)');
    await this.sessions.touch(wallet); // makes sure the player exists (and applies the daily grant)
    // The price is fetched BEFORE the transaction (no row lock is held across an HTTP call) and only when a NEW order will be needed – re-asking for the
    // order or ride already in hand must not wait on the price feeds. Best effort: the locked transaction below re-decides and 503s if it then needs one.
    const quote = paid && (await this.needsNewOrder(wallet, tier)) ? await this.price.solUsd().catch(() => null) : null;
    return this.transactions.run(async (tx) => {
      const now = this.clock.now();
      const player = await this.players.findByWalletForUpdate(wallet, tx);
      if (!player) throw new NotFoundError('player not found');
      let open = await this.rides.findOpenByWallet(wallet, tx);
      if (open?.isStaleRunning(now, rules)) { // a tab that vanished mid-ride must not block the wallet forever
        open.failHeartbeatLost(now);
        await this.rides.save(open, tx);
        open = await this.rides.findOpenByWallet(wallet, tx);
      }
      if (open?.isInStatus(RideStatus.Running)) throw new ConflictError('a ride is already in progress');
      let creditRefunded = false;
      if (open?.isInStatus(RideStatus.Created)) {
        if (!open.isFree || !paid) return toRideDto(open);
        open.cancelReplaced(now);
        await this.rides.save(open, tx);
        player.refundFreeRide();
        creditRefunded = true;
      } else if (open) {
        if (open.tier === tier && open.quoteIsLive(now)) return toRideDto(open);
        open.expire(now);
        await this.rides.save(open, tx);
      }
      const ride = this.newRide(wallet, tier, quote, now, player);
      if (creditRefunded || !paid) await this.players.save(player, tx);
      await this.rides.insert(ride, tx);
      return toRideDto(ride);
    });
  }

  /** Would this request create a new paid order? (the same decisions as the transaction, read without the lock) */
  private async needsNewOrder(wallet: string, tier: CreateRideCommand['tier']): Promise<boolean> {
    const open = await this.rides.findOpenByWallet(wallet);
    const now = this.clock.now();
    if (!open || open.isStaleRunning(now, this.rules.get())) return true;
    if (open.isInStatus(RideStatus.Running)) return false; // 409 anyway
    if (open.isInStatus(RideStatus.Created)) return open.isFree; // an unstarted free ride is replaced; a paid one is handed back
    return !(open.tier === tier && open.quoteIsLive(now)); // the same, still-quoted order is handed back
  }

  private newRide(wallet: string, tier: CreateRideCommand['tier'], quote: PriceQuote | null, now: Date, player: { spendFreeRide(): void }): Ride {
    const rules = this.rules.get();
    const def = rideTier(tier, rules.freeRideSeconds);
    const id = this.entropy.uuid();
    const seed = this.entropy.seed31();
    if (!isPaidTier(tier)) {
      player.spendFreeRide();
      return Ride.createFree({ id, wallet, seed, minSeconds: def.seconds, now });
    }
    if (!quote) throw new ServiceUnavailableError('no SOL/USD price available right now');
    const timeScale = isDemoWallet(rules, wallet) ? demoScaleOf(rules) : 1; // demo wallets only, never the free tier
    return Ride.createPaidOrder({
      id, wallet, tier, seed, minSeconds: def.seconds / timeScale, timeScale, priceUsd: def.usd, lamports: lamportsFor(def.usd, quote.usd), solUsd: quote.usd, now, quoteTtlMs: rules.quoteTtlMs,
    });
  }
}
