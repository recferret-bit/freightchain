import { CommandHandler, type ICommandHandler } from '@nestjs/cqrs';
import { lamportsFor } from '../../../../domain/economy/prize-split.js';
import { toRideDto, type RideDto } from '../../../../domain/rides/ride.dto.js';
import { Ride, type RideProps } from '../../../../domain/rides/ride.entity.js';
import { RideStatus } from '../../../../domain/rides/ride-status.js';
import { isPaidTier, isTierOnSale, rideTier, tierShiftName, type PaidTierId } from '../../../../domain/rides/ride-tier.js';
import { DEFAULT_FREE_LEVEL, assertAssistAllowed, assertTutorialAllowed, freeLevelSeconds, type FreeLevel } from '../../../../domain/rides/ride-trip.js';
import type { Round } from '../../../../domain/economy/round.entity.js';
import { PoolTicketsService } from '../../../services/pool-tickets.service.js';
import { RoundService } from '../../../services/round.service.js';
import { withVersionRetry } from '../../../services/version-retry.js';
import { ConflictError, NotFoundError, ServiceUnavailableError } from '../../../../domain/shared/errors.js';
import { AnalyticsPort } from '../../../ports/analytics/analytics.port.js';
import { RulesConfigPort } from '../../../ports/config/rules-config.port.js';
import { PriceQuotePort, type PriceQuote } from '../../../ports/economy/price-quote.port.js';
import { PlayerRepositoryPort } from '../../../ports/players/player.repository.port.js';
import { RideRepositoryPort } from '../../../ports/rides/ride.repository.port.js';
import { DailySeedRepositoryPort } from '../../../ports/rides/daily-seed.repository.port.js';
import { seedDayOf } from '../../../../domain/rides/ride-day.js';
import { ClockPort } from '../../../ports/shared/clock.port.js';
import { EntropyPort } from '../../../ports/shared/entropy.port.js';
import { TransactionPort, type TransactionHandle } from '../../../ports/shared/transaction.port.js';
import { rideCancelled, rideExpired, rideFailed, rideOrdered, rideResumed } from '../../../services/analytics-events.js';
import { emitAnalytics } from '../../../services/analytics-emit.js';
import { StatsService } from '../../../services/stats.service.js';
import { PlayerSessionService } from '../../../services/player-session.service.js';
import { isDemoWallet, demoScaleOf } from '../../../services/demo.js';
import { CreateRideCommand } from './create-ride.command.js';

/** Plain facts from the committed transaction. The AnalyticsEvent is built only after `transactions.run` resolves. */
interface CreateFacts {
  dto: RideDto;
  now: Date;
  ordered: RideProps | null;
  resumed: RideProps | null;
  failed: RideProps | null;
  expired: RideProps | null;
  cancelled: RideProps | null;
  freeRidesLeft: number;
}

/**
 * Get the wallet a ride. A wallet has at most ONE ride in hand, and everything it does to its rides and free credits runs under a row lock on its player
 * (parallel requests queue up), so two parallel POSTs can neither create two rides nor spend one credit twice.
 *   running                → 409
 *   ready (created)        → the same ride back – a PAID one is never lost; an unstarted FREE one is cancelled (credit refunded) when a paid tier is bought
 *   awaiting payment       → the same order while its tier matches and the price is still held; otherwise it lapses (a late matching payment is still honoured)
 * A paid tier that is not on sale (1h, 4h, 8h) and has no live pool is refused before the lock (409 `tier_not_on_sale`), so an open order of another tier is not expired.
 * A registered live pool of that tier still sells tickets. A paid tier that sells through escrowed pools is paid with a TICKET: one is spent in the same locked
 * transaction and the ride is ready at once (409 `no_tickets` / `pool_not_live` / `rides_closed` – a ticket of a live pool past its play deadline). In `program` mode that is the only way; in `transfer` mode an on-sale tier with no pool still uses the legacy pay-per-ride order.
 * A FREE ride is ordered at a LEVEL (ride-trip.ts FREE_LEVELS, default 1): its trip, FREE_RIDE_SECONDS × its multiple, its finish line. TUTORIAL or ASSIST on a
 * level without it (HARD) is refused (409 `tutorial_not_allowed` / `assist_not_allowed`), a level on a paid tier too (409 `level_free_only`). Asking for the ready free ride again re-chooses
 * its level (trip, country, length) and helpers on that SAME ride (same seed, same credit) – the lobby never sends you onto a road you did not pick; a request with no `level` keeps
 * the ride's own level. The country is the level's (FREE_LEVELS.route), not the seed's.
 * ONE ROAD PER COMPETITION: a ticket ride is driven on its pool's seed (`Pool.rideSeed`), a pay-per-ride order on its tier's seed of the UTC day it was ordered
 * (`DailySeedRepositoryPort`, the day's first order draws it) – every rider of a pool, or of a tier that day, drives the same route, start hour, layout and holes.
 * Free rides draw a seed each (layout, holes, start hour); the country is the level's.
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
    private readonly poolTickets: PoolTicketsService,
    private readonly rounds: RoundService,
    private readonly analytics: AnalyticsPort,
    private readonly stats: StatsService,
    private readonly dailySeeds: DailySeedRepositoryPort,
  ) {}

  async execute({ wallet, tier, tutorial, assist, level: asked }: CreateRideCommand): Promise<RideDto> {
    const rules = this.rules.get();
    const paid = isPaidTier(tier);
    if (paid && (tutorial || assist)) throw new ConflictError('the tutorial and assist are for free rides only'); // assist must never reach a ranked, paid ride
    if (paid && asked !== null) throw new ConflictError('a level is for free rides only', 'level_free_only');
    const level = asked ?? DEFAULT_FREE_LEVEL;
    if (!paid) { assertAssistAllowed(level, assist); assertTutorialAllowed(level, tutorial); } // before the lock: a refused HARD helper leaves the ride in hand alone
    const livePool = paid && (await this.poolTickets.tierHasPools(tier as PaidTierId));
    // before the lock, and before touch: a soon-tier request must not expire the order in hand and must not open a player row
    if (paid && !isTierOnSale(tier) && !livePool) throw new ConflictError(`the ${tierShiftName(tier as PaidTierId)} shift is not on sale yet`, 'tier_not_on_sale');
    await this.sessions.touch(wallet); // makes sure the player exists (and applies the daily grant)
    // program mode sells paid rides ONLY as pool tickets (a tier whose pools all failed has none to ride, never a fallback order); transfer mode keeps the legacy order where no pool is registered
    const viaTickets = paid && (rules.paymentMode === 'program' || livePool);
    if (paid && !viaTickets && !rules.treasury) throw new ServiceUnavailableError('paid rides are not configured on this server (no treasury)');
    const round = viaTickets ? await this.rounds.ensureRound() : null; // the round a ticket ride ranks in when its pool has none yet (outside the lock: it may insert)
    // The price is fetched BEFORE the transaction (no row lock is held across an HTTP call) and only when a NEW order will be needed – re-asking for the
    // order or ride already in hand must not wait on the price feeds. Best effort: the locked transaction below re-decides and 503s if it then needs one.
    const quote = paid && !viaTickets && (await this.needsNewOrder(wallet, tier)) ? await this.price.solUsd().catch(() => null) : null;
    const facts = await withVersionRetry(() => this.transactions.run(async (tx) => {
      const now = this.clock.now();
      const player = await this.players.findByWalletForUpdate(wallet, tx);
      if (!player) throw new NotFoundError('player not found');
      let open = await this.rides.findOpenByWallet(wallet, tx);
      let failed: RideProps | null = null;
      if (open?.isStaleRunning(now, rules)) { // a tab that vanished mid-ride must not block the wallet forever
        open.failHeartbeatLost(now);
        await this.rides.save(open, tx);
        failed = open.snapshot();
        await this.stats.recordRide(failed, tx);
        open = await this.rides.findOpenByWallet(wallet, tx);
      }
      if (open?.isInStatus(RideStatus.Running)) throw new ConflictError('a ride is already in progress');
      if (open?.isInStatus(RideStatus.Created) && (!open.isFree || !paid)) {
        if (!open.isFree) player.requirePaidPlay(); // handing back a paid ride is still paid play, even when this request asked for a free one
        const again = asked ?? open.level ?? DEFAULT_FREE_LEVEL; // no level in the request = the ride keeps its own (never a silent fall back to EASY)
        if (open.isFree && !paid && open.chooseFree(again, freeLevelSeconds(again, rules.freeRideSeconds), tutorial, assist)) await this.rides.save(open, tx); // the same ready free ride, re-chosen: the level + checkboxes the lobby sent this time
        return { dto: toRideDto(open), now, ordered: null, resumed: open.snapshot(), failed, expired: null, cancelled: null, freeRidesLeft: player.freeRides };
      }
      // after the cheap refusals (tutorial, level, not on sale, no treasury) and before a ticket, a resumed quote, or a new order
      if (paid) player.requirePaidPlay();
      // the ticket is spent before anything else changes, so a refused spend (409) leaves the wallet exactly as it was
      const ticketed = viaTickets ? await this.ticketRide(wallet, tier as PaidTierId, round as Round, now, tx) : null;
      let creditRefunded = false;
      let cancelled: RideProps | null = null;
      let expired: RideProps | null = null;
      if (open?.isInStatus(RideStatus.Created)) {
        open.cancelReplaced(now);
        await this.rides.save(open, tx);
        cancelled = open.snapshot();
        player.refundFreeRide();
        creditRefunded = true;
      } else if (open) {
        if (!viaTickets && open.tier === tier && open.quoteIsLive(now)) { // with tickets a legacy order just lapses
          return { dto: toRideDto(open), now, ordered: null, resumed: open.snapshot(), failed, expired, cancelled, freeRidesLeft: player.freeRides };
        }
        open.expire(now);
        await this.rides.save(open, tx);
        expired = open.snapshot();
      }
      const ride = ticketed ?? (await this.newRide(wallet, tier, quote, now, player, { tutorial, assist, level }, tx));
      if (creditRefunded || !paid) await this.players.save(player, tx);
      await this.rides.insert(ride, tx);
      return { dto: toRideDto(ride), now, ordered: ride.snapshot(), resumed: null, failed, expired, cancelled, freeRidesLeft: player.freeRides };
    }));
    if (facts.failed) await this.stats.invalidate(wallet); // a stale ride this call ended joined the statistics
    this.emit(wallet, facts);
    return facts.dto;
  }

  /** Spends one ticket of the tier (the caller holds the player lock) and makes the ready ride in that ticket's pool, on the POOL's seed: every rider of a pool
      drives the same road (route, start hour, layout, holes), so they compete on one ride. */
  private async ticketRide(wallet: string, tier: PaidTierId, round: Round, now: Date, tx: TransactionHandle): Promise<Ride> {
    const rules = this.rules.get();
    const id = this.entropy.uuid();
    const pool = await this.poolTickets.spendForRide(wallet, tier, id, now, tx);
    const seed = pool.rideSeed;
    const timeScale = isDemoWallet(rules, wallet) ? demoScaleOf(rules) : 1;
    const minSeconds = rideTier(tier, rules.freeRideSeconds).seconds / timeScale;
    return Ride.createFromTicket({
      id, wallet, tier, seed, minSeconds, timeScale, poolId: pool.id, roundId: pool.roundId ?? round.id, now,
      seedCommitment: pool.seedCommitment, blockhash: pool.blockhash, slot: pool.slot,
    });
  }

  private emit(wallet: string, facts: CreateFacts): void {
    const demo = (): boolean => isDemoWallet(this.rules.get(), wallet);
    if (facts.failed) { const failed = facts.failed; emitAnalytics(this.analytics, () => rideFailed(failed, demo(), 'stale_on_create')); }
    if (facts.expired) { const expired = facts.expired; emitAnalytics(this.analytics, () => rideExpired(expired, demo())); }
    if (facts.cancelled) { const cancelled = facts.cancelled; emitAnalytics(this.analytics, () => rideCancelled(cancelled, demo())); }
    if (facts.ordered) { const ordered = facts.ordered; emitAnalytics(this.analytics, () => rideOrdered(ordered, demo(), facts.freeRidesLeft)); }
    if (facts.resumed) { const resumed = facts.resumed; emitAnalytics(this.analytics, () => rideResumed(resumed, demo(), facts.now)); }
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

  private async newRide(wallet: string, tier: CreateRideCommand['tier'], quote: PriceQuote | null, now: Date, player: { spendFreeRide(): void }, free: { tutorial: boolean; assist: boolean; level: FreeLevel }, tx: TransactionHandle): Promise<Ride> {
    const rules = this.rules.get();
    const def = rideTier(tier, rules.freeRideSeconds);
    const id = this.entropy.uuid();
    if (!isPaidTier(tier)) {
      player.spendFreeRide();
      return Ride.createFree({ id, wallet, seed: this.entropy.seed31(), minSeconds: freeLevelSeconds(free.level, rules.freeRideSeconds), now, ...free });
    }
    if (!quote) throw new ServiceUnavailableError('no SOL/USD price available right now');
    const seed = await this.dailySeeds.claim(tier as PaidTierId, seedDayOf(now), this.entropy.seed31(), now, tx); // the tier's road of the day: every order of it today drives the same ride
    const timeScale = isDemoWallet(rules, wallet) ? demoScaleOf(rules) : 1; // demo wallets only, never the free tier
    return Ride.createPaidOrder({
      id, wallet, tier, seed, minSeconds: def.seconds / timeScale, timeScale, priceUsd: def.usd, lamports: lamportsFor(def.usd, quote.usd), solUsd: quote.usd, now, quoteTtlMs: rules.quoteTtlMs,
    });
  }
}
