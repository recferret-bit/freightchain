import { GameSettingsService } from '../../../services/game-settings.service.js';
import { PRESEASON_PROMO_CODE, eventWindow } from '../../../../domain/settings/preseason-event.js';
import { Optional } from '@nestjs/common';
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
import type { Player } from '../../../../domain/players/player.entity.js';
import { FINISH_RULES_VERSION } from '../../../../domain/road/finish-for.js';
import { BadRequestError, ConflictError, NotFoundError, ServiceUnavailableError } from '../../../../domain/shared/errors.js';
import { FinishRulesPort } from '../../../rides/finish-rules.port.js';
import type { GeoHeaders } from '../../../ports/prize/geo-locator.port.js';
import { AnalyticsPort } from '../../../ports/analytics/analytics.port.js';
import { RulesConfigPort } from '../../../ports/config/rules-config.port.js';
import { PriceQuotePort, type PriceQuote } from '../../../ports/economy/price-quote.port.js';
import { PlayerRepositoryPort } from '../../../ports/players/player.repository.port.js';
import { RideRepositoryPort } from '../../../ports/rides/ride.repository.port.js';
import { PromoRepositoryPort } from '../../../ports/economy/promo.repository.port.js';
import { DailySeedRepositoryPort } from '../../../ports/rides/daily-seed.repository.port.js';
import { seedDayOf } from '../../../../domain/rides/ride-day.js';
import { ClockPort } from '../../../ports/shared/clock.port.js';
import { EntropyPort } from '../../../ports/shared/entropy.port.js';
import { TransactionPort, type TransactionHandle } from '../../../ports/shared/transaction.port.js';
import { rideCancelled, rideExpired, rideFailed, rideOrdered, rideResumed } from '../../../services/analytics-events.js';
import { emitAnalytics } from '../../../services/analytics-emit.js';
import { StatsService } from '../../../services/stats.service.js';
import { PlayerSessionService } from '../../../services/player-session.service.js';
import { WeeklyTicketService } from '../../../services/weekly-ticket.service.js';
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
 * Get the wallet a ride. A wallet has at most ONE ride in hand. Everything it does to its rides runs under a row lock on its player
 * (parallel requests queue up), so two parallel POSTs cannot create two rides. Training rides are unlimited. A matching weekly grant is taken before a ticket or a payment.
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
    private readonly promos: PromoRepositoryPort,
    private readonly weekly: WeeklyTicketService,
    @Optional() private readonly finishRules?: FinishRulesPort,
    @Optional() private readonly settings?: GameSettingsService,
  ) {}

  async execute({ wallet, tier, tutorial, assist, level: asked, geo }: CreateRideCommand): Promise<RideDto> {
    if (tier === '4h' || tier === '8h') throw new BadRequestError('4h and 8h shifts are not created', 'tier_retired');
    const rules = this.rules.get();
    const paid = isPaidTier(tier);
    if (paid && (tutorial || assist)) throw new ConflictError('the tutorial and assist are for free rides only'); // assist must never reach a ranked, paid ride
    if (paid && asked !== null) throw new ConflictError('a level is for free rides only', 'level_free_only');
    const level = asked ?? DEFAULT_FREE_LEVEL;
    if (!paid) { assertAssistAllowed(level, assist); assertTutorialAllowed(level, tutorial); } // before the lock: a refused HARD helper leaves the ride in hand alone
    const campaignSettings = await this.settings?.current();
    const eventEnabled = campaignSettings?.eventModeEnabled === 1;
    const window = campaignSettings ? eventWindow(campaignSettings) : null;
    if (paid && eventEnabled && (!window || this.clock.now() < window.start || this.clock.now() > window.lastStart)) throw new ConflictError('the event start window is closed', 'event_closed');
    const promoSource = eventEnabled ? 'event' : 'ordinary';
    const livePool = paid && (await this.poolTickets.tierHasPools(tier as PaidTierId));
    const promoWaiting = paid && (await this.promos.hasUnspent(wallet, tier as PaidTierId, undefined, promoSource));
    const held = paid && !promoWaiting ? await this.rides.findOpenByWallet(wallet) : null;
    const holdingReady = held?.isInStatus(RideStatus.Created) && !held.isFree && held.tier === tier;
    if (paid && eventEnabled && !promoWaiting && !(holdingReady && held?.promoCode === PRESEASON_PROMO_CODE)) throw new ConflictError('complete the campaign to receive the event attempt', 'event_attempt_required');
    const playerRow = await this.sessions.touch(wallet);
    if (playerRow.guest && (paid || level !== DEFAULT_FREE_LEVEL)) throw new ConflictError('a guest session can only play the EASY run', 'guest_easy_only');
    const grantPossible = paid && (await this.weekly.offer(playerRow, geo, this.clock.now())).some((t) => t.tier === tier);
    // A soon-tier request must not expire the order in hand. A waiting ride promo, a ready ride already in hand, or this week's grant is not a sale.
    if (paid && !promoWaiting && !holdingReady && !grantPossible && !isTierOnSale(tier) && !livePool) throw new ConflictError(`the ${tierShiftName(tier as PaidTierId)} shift is not on sale yet`, 'tier_not_on_sale');
    // program mode sells paid rides ONLY as pool tickets (a tier whose pools all failed has none to ride, never a fallback order); transfer mode keeps the legacy order where no pool is registered
    const selling = paid && (rules.paymentMode === 'program' || livePool);
    if (paid && !selling && !promoWaiting && !grantPossible && !rules.treasury) throw new ServiceUnavailableError('paid rides are not configured on this server (no treasury)');
    const round = selling ? await this.rounds.ensureRound() : null; // the round a ticket ride ranks in when its pool has none yet (outside the lock: it may insert)
    // The price is fetched BEFORE the transaction (no row lock is held across an HTTP call) and only when a NEW order will be needed – re-asking for the
    // order or ride already in hand must not wait on the price feeds. Best effort: the locked transaction below re-decides and 503s if it then needs one.
    const quote = paid && !selling && !promoWaiting && !grantPossible && (await this.needsNewOrder(wallet, tier)) ? await this.price.solUsd().catch(() => null) : null;
    const facts = await withVersionRetry(() => this.transactions.run(async (tx) => {
      const now = this.clock.now();
      const player = await this.players.findByWalletForUpdate(wallet, tx);
      if (!player) throw new NotFoundError('player not found');
      let open = await this.rides.findOpenByWallet(wallet, tx);
      let failed: RideProps | null = null, expiredEvent: RideProps | null = null;
      if (open?.isInStatus(RideStatus.Created) && open.promoCode === PRESEASON_PROMO_CODE && (!window || now > window.lastStart)) {
        open.closeExpiredEvent(now);
        await this.rides.save(open, tx);
        expiredEvent = open.snapshot();
        await this.stats.recordRide(expiredEvent, tx);
        open = null;
      }
      if (open?.isStaleRunning(now, rules)) { // a tab that vanished mid-ride must not block the wallet forever
        open.failHeartbeatLost(now);
        await this.rides.save(open, tx);
        failed = open.snapshot();
        await this.stats.recordRide(failed, tx);
        open = await this.rides.findOpenByWallet(wallet, tx);
      }
      if (open?.isInStatus(RideStatus.Running)) throw new ConflictError('a ride is already in progress');
      if (open?.isInStatus(RideStatus.Created) && (!open.isFree || !paid)) {
        if (!open.isFree && !open.isPromo && !open.isWeeklyGrant) player.requirePaidPlay(); // handing back a bought ride is still paid play. A promo and the weekly grant were not bought.
        const again = asked ?? open.level ?? DEFAULT_FREE_LEVEL; // no level in the request = the ride keeps its own (never a silent fall back to EASY)
        if (open.isFree && !paid && open.chooseFree(again, freeLevelSeconds(again, rules.freeRideSeconds), tutorial, assist)) await this.rides.save(open, tx); // the same ready free ride, re-chosen: the level + checkboxes the lobby sent this time
        return { dto: toRideDto(open), now, ordered: null, resumed: open.snapshot(), failed, expired: null, cancelled: null, freeRidesLeft: player.freeRides };
      }
      // A ride promo is claimed before a ticket or a payment. The grant is the ride; it is not a purchase.
      const promoId = this.entropy.uuid();
      const promoCode = paid ? await this.promos.claimUnspent(wallet, tier as PaidTierId, promoId, tx, promoSource) : null;
      if (paid && eventEnabled && !promoCode) throw new ConflictError('the event attempt has already been used', 'event_attempt_used');
      const grant = paid && !promoCode ? await this.weekly.offer(player, geo, now, tx) : [];
      const takingGrant = grant.some((t) => t.tier === tier);
      if (paid && !promoCode && !takingGrant && !isTierOnSale(tier) && !livePool) throw new ConflictError(`the ${tierShiftName(tier as PaidTierId)} shift is not on sale yet`, 'tier_not_on_sale');
      if (paid && !promoCode && !takingGrant) player.requirePaidPlay();
      const ticketed = !promoCode && !takingGrant && selling ? await this.ticketRide(wallet, tier as PaidTierId, round as Round, now, tx) : null;
      let cancelled: RideProps | null = expiredEvent;
      let expired: RideProps | null = null;
      if (open?.isInStatus(RideStatus.Created)) {
        open.cancelReplaced(now);
        await this.rides.save(open, tx);
        cancelled = open.snapshot();
      } else if (open) {
        if (!promoCode && !takingGrant && !selling && open.tier === tier && open.quoteIsLive(now)) { // with tickets, a promo, or the weekly grant, a legacy order just lapses
          return { dto: toRideDto(open), now, ordered: null, resumed: open.snapshot(), failed, expired, cancelled, freeRidesLeft: player.freeRides };
        }
        open.expire(now);
        await this.rides.save(open, tx);
        expired = open.snapshot();
      }
      const ride = promoCode
        ? await this.promoRide(promoId, wallet, tier as PaidTierId, promoCode, now, tx)
        : takingGrant
          ? await this.grantedRide(wallet, tier as PaidTierId, now, tx, player, geo)
          : ticketed ?? (await this.newRide(wallet, tier, quote, now, { tutorial, assist, level }, tx));
      await this.rides.insert(ride, tx);
      if (this.finishRules && ride.tier === '1h' && ride.minSeconds >= 3600) await this.finishRules.stamp(ride.id, FINISH_RULES_VERSION, tx);
      return { dto: toRideDto(ride), now, ordered: ride.snapshot(), resumed: null, failed, expired, cancelled, freeRidesLeft: player.freeRides };
    }));
    if (facts.failed || facts.cancelled) await this.stats.invalidate(wallet); // a stale ride this call ended joined the statistics
    this.emit(wallet, facts);
    return facts.dto;
  }

  /** This tier's granted ticket, claimed in this transaction. Ready, price 0, its own seed. Not a purchase and not TEN4. */
  private async grantedRide(wallet: string, tier: PaidTierId, now: Date, tx: TransactionHandle, player: Player, geo: GeoHeaders): Promise<Ride> {
    const rules = this.rules.get();
    const id = this.entropy.uuid();
    if (!(await this.weekly.claim(player, geo, tier, id, now, tx))) throw new ConflictError('the weekly ticket was already used', 'weekly_ticket_spent');
    const timeScale = isDemoWallet(rules, wallet) ? demoScaleOf(rules) : 1;
    const minSeconds = rideTier(tier, rules.freeRideSeconds).seconds / timeScale;
    return Ride.createWeeklyGrant({ id, wallet, tier, seed: this.entropy.seed31(), minSeconds, timeScale, now });
  }

  /** A claimed ride promo: the catalog length, price 0, its own seed. Not the pool's road and not a daily seed. */
  private async promoRide(id: string, wallet: string, tier: PaidTierId, promoCode: string, now: Date, tx: TransactionHandle): Promise<Ride> {
    const rules = this.rules.get(), event = promoCode === PRESEASON_PROMO_CODE;
    const timeScale = !event && isDemoWallet(rules, wallet) ? demoScaleOf(rules) : 1;
    const minSeconds = rideTier(tier, rules.freeRideSeconds).seconds / timeScale;
    const seed = event ? await this.dailySeeds.claim(tier, 'event:preseason-2026-11', this.entropy.seed31(), now, tx) : this.entropy.seed31();
    return Ride.createPromo({ id, wallet, tier, seed, minSeconds, timeScale, promoCode, now });
  }

  /** Spends one ticket of the tier (the caller holds the player lock) and makes the ready ride in that ticket's pool, on the POOL's seed: every rider of a pool
      drives the same road (route, start hour, layout, holes), so they compete on one ride. */
  private async ticketRide(wallet: string, tier: PaidTierId, round: Round, now: Date, tx: TransactionHandle): Promise<Ride> {
    const rules = this.rules.get();
    const id = this.entropy.uuid();
    const timeScale = isDemoWallet(rules, wallet) ? demoScaleOf(rules) : 1;
    const minSeconds = rideTier(tier, rules.freeRideSeconds).seconds / timeScale;
    const pool = await this.poolTickets.spendForRide(wallet, tier, id, now, tx, minSeconds);   // only a pool where this shift, started now, ends by the play deadline
    const seed = pool.rideSeed;
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

  private async newRide(wallet: string, tier: CreateRideCommand['tier'], quote: PriceQuote | null, now: Date, free: { tutorial: boolean; assist: boolean; level: FreeLevel }, tx: TransactionHandle): Promise<Ride> {
    const rules = this.rules.get();
    const def = rideTier(tier, rules.freeRideSeconds);
    const id = this.entropy.uuid();
    if (!isPaidTier(tier)) {
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
