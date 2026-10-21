import { Injectable } from '@nestjs/common';
import { liveFeatures, refusalFor } from '../../domain/live/live-features.js';
import type { EffectId } from '../../domain/live/live-rules.js';
import { DONATION_ORDER_TTL_MS, MAX_OPEN_DONATION_ORDERS, TIP_DEFAULT_LAMPORTS, TIP_MAX_LAMPORTS, TIP_MIN_LAMPORTS, tipSplit } from '../../domain/live/tip-rules.js';
import type { Ride } from '../../domain/rides/ride.entity.js';
import { BadRequestError, ConflictError, ForbiddenError, TooManyRequestsError } from '../../domain/shared/errors.js';
import { RulesConfigPort } from '../ports/config/rules-config.port.js';
import { DonationOrderRepositoryPort } from '../ports/live/donation-order.repository.port.js';
import { RideMuteRepositoryPort } from '../ports/live/ride-mute.repository.port.js';
import { ClockPort } from '../ports/shared/clock.port.js';
import { ReplayAccessService } from './replay-access.service.js';

export interface PreparedTip {
  ride: Ride;
  /** what the donor pays */
  lamports: number;
  driverLamports: number;
  treasuryLamports: number;
  treasury: string;
}

/** Replay-only SOL tips. Gameplay effects are refused. The referrer is not paid. */
@Injectable()
export class LiveDonationService {
  constructor(
    private readonly access: ReplayAccessService,
    private readonly orders: DonationOrderRepositoryPort,
    private readonly mutes: RideMuteRepositoryPort,
    private readonly rules: RulesConfigPort,
    private readonly clock: ClockPort,
  ) {}

  /** `order` = a chain transfer. `mock` = the free route, which records a tip and moves no SOL. */
  async prepare(wallet: string, rideId: string, effect: EffectId, lamports: number | null, mode: 'order' | 'mock'): Promise<PreparedTip> {
    if (effect !== 'tip') throw new BadRequestError('only tip donations are accepted', 'donation_effect');
    const amount = lamports ?? TIP_DEFAULT_LAMPORTS;
    if (!Number.isInteger(amount) || amount < TIP_MIN_LAMPORTS) throw new BadRequestError('a tip is at least 0.001 SOL', 'donation_too_small');
    if (amount > TIP_MAX_LAMPORTS) throw new BadRequestError('a tip is at most 1 SOL', 'donation_too_large');
    const ride = await this.access.requireWatchable(rideId, wallet);
    if (ride.wallet === wallet) throw new BadRequestError('you cannot tip your own ride', 'own_ride');
    const features = liveFeatures(this.rules.get().live, ride);
    const refused = refusalFor(features, { kind: 'donation', effect: 'tip' });
    if (refused) throw new ForbiddenError(refused, 'live_feature_off');
    if (await this.mutes.isMuted(ride.id, wallet)) throw new ForbiddenError('the driver muted you on this ride', 'muted');
    const chain = features.payment === 'chain';
    if (mode === 'order' && !chain) throw new ConflictError('donations are free (mock) on this server – post them directly', 'payment_not_needed');
    if (mode === 'mock' && chain) throw new ForbiddenError('donations are paid with a real transfer here – use a donation order', 'payment_required');
    const now = this.clock.now();
    const treasury = this.rules.get().treasury;
    if (mode === 'order') {
      if (!treasury) throw new ConflictError('the treasury is not configured', 'treasury_missing');
      const open = await this.orders.countOpen(wallet, new Date(now.getTime() - DONATION_ORDER_TTL_MS));
      if (open >= MAX_OPEN_DONATION_ORDERS) throw new TooManyRequestsError('at most 3 open donation orders', 'too_many_open_orders');
    }
    const split = tipSplit(amount);
    return { ride, lamports: amount, driverLamports: split.driver, treasuryLamports: split.treasury, treasury };
  }
}
