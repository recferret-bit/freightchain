import { Injectable } from '@nestjs/common';
import { Payment } from '../../domain/economy/payment.entity.js';
import { toRideDto, type RideDto } from '../../domain/rides/ride.dto.js';
import type { Ride, RideProps } from '../../domain/rides/ride.entity.js';
import { RideStatus } from '../../domain/rides/ride-status.js';
import { ConflictError, NotFoundError, ServiceUnavailableError, VersionConflictError } from '../../domain/shared/errors.js';
import { PaymentRepositoryPort } from '../ports/economy/payment.repository.port.js';
import { RoundRepositoryPort } from '../ports/economy/round.repository.port.js';
import { PlayerRepositoryPort } from '../ports/players/player.repository.port.js';
import { RideRepositoryPort } from '../ports/rides/ride.repository.port.js';
import { TransactionPort, type TransactionHandle } from '../ports/shared/transaction.port.js';
import { ClockPort } from '../ports/shared/clock.port.js';
import { RideLookupService } from './ride-lookup.service.js';
import { RoundService } from './round.service.js';

/** The round closed between choosing it and locking it (the week just turned): choose again. */
class RoundClosed extends Error {}

const ATTEMPTS = 3;

/** `inserted` is true only when THIS call wrote the Payment. `paidAt` is that row's `at`, and null when another caller already did.
 *  `cancelled` / `expired` are sibling rides THIS insert closed. Both stay empty when `inserted` is false: the race loser did not close them. */
export interface SettlementResult {
  ride: RideDto;
  inserted: boolean;
  paidAt: Date | null;
  cancelled: RideProps[];
  expired: RideProps[];
}

/**
 * Records a VERIFIED payment, in one transaction under the wallet's row lock: the order becomes a ready ride in the current round's pool.
 *  - A paid ride is never lost, and the wallet keeps one ride in hand: an unstarted FREE ride is cancelled (credit refunded) and another unpaid order lapses –
 *    exactly what buying does. (Two PAID rides can coexist – both are owed; only one can run at a time, see StartRideHandler.)
 *  - Idempotent: a concurrent confirm / reconcile of the same transaction that loses the race answers "paid" too, never "already used".
 *  - The round row is locked while the payment goes in, so it cannot be closed (its carry computed) without this payment – see RoundService.
 */
@Injectable()
export class PaymentSettlementService {
  constructor(
    private readonly rounds: RoundService,
    private readonly roundRepo: RoundRepositoryPort,
    private readonly payments: PaymentRepositoryPort,
    private readonly rides: RideRepositoryPort,
    private readonly players: PlayerRepositoryPort,
    private readonly lookup: RideLookupService,
    private readonly transactions: TransactionPort,
    private readonly clock: ClockPort,
  ) {}

  async settle(rideId: string, wallet: string, signature: string): Promise<SettlementResult> {
    for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
      try {
        return await this.settleOnce(rideId, wallet, signature);
      } catch (error) {
        if (error instanceof RoundClosed) continue;
        if (error instanceof ConflictError || error instanceof VersionConflictError) {
          // lost a race: if that was THIS payment being recorded by a concurrent request, the outcome is "paid", not an error
          const recorded = await this.payments.findBySignature(signature);
          if (recorded?.rideId === rideId) return { ride: toRideDto(await this.lookup.require(rideId, wallet)), inserted: false, paidAt: null, cancelled: [], expired: [] };
        }
        throw error;
      }
    }
    throw new ServiceUnavailableError('the weekly round is turning over – try again');
  }

  private async settleOnce(rideId: string, wallet: string, signature: string): Promise<SettlementResult> {
    const now = this.clock.now();
    const round = await this.rounds.ensureRound(now);
    return this.transactions.run(async (tx) => {
      const player = await this.players.findByWalletForUpdate(wallet, tx);
      if (!player) throw new NotFoundError('player not found');
      if (!(await this.roundRepo.lockOpen(round.id, tx))) throw new RoundClosed();
      const ride = await this.lookup.require(rideId, wallet, tx); // re-read under the lock
      ride.markPaid(round.id, now);
      const room = await this.makeRoomFor(ride, now, tx);
      if (room.refunded) {
        player.refundFreeRide();
        await this.players.save(player, tx);
      }
      // the unique signature / ride keys make a concurrent double-settle fail here with a ConflictError, rolling the whole transaction back
      await this.payments.insert(new Payment({ signature, rideId: ride.id, wallet, lamports: ride.lamports, usd: ride.priceUsd, roundId: round.id, at: now }), tx);
      return { ride: toRideDto(await this.rides.save(ride, tx)), inserted: true, paidAt: now, cancelled: room.cancelled, expired: room.expired };
    });
  }

  /** Cancel an unstarted free ride (refund its credit) and let other unpaid orders lapse. Running and other paid rides stay. */
  private async makeRoomFor(paid: Ride, now: Date, tx: TransactionHandle): Promise<{ refunded: boolean; cancelled: RideProps[]; expired: RideProps[] }> {
    const cancelled: RideProps[] = [];
    const expired: RideProps[] = [];
    for (const other of await this.rides.listOpenByWallet(paid.wallet, tx)) {
      if (other.id === paid.id) continue;
      if (other.isFree && other.isInStatus(RideStatus.Created)) {
        other.cancelReplaced(now);
        cancelled.push(other.snapshot());
      } else if (other.isInStatus(RideStatus.AwaitingPayment)) {
        other.expire(now);
        expired.push(other.snapshot());
      } else {
        continue;
      }
      await this.rides.save(other, tx);
    }
    return { refunded: cancelled.length > 0, cancelled, expired };
  }
}
