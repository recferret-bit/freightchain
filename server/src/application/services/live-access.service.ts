import { Injectable } from '@nestjs/common';
import { liveFeatures, refusalFor, type LiveFeaturesDto } from '../../domain/live/live-features.js';
import type { EffectId } from '../../domain/live/live-rules.js';
import type { Ride } from '../../domain/rides/ride.entity.js';
import { RideStatus } from '../../domain/rides/ride-status.js';
import { ConflictError, ForbiddenError, NotFoundError } from '../../domain/shared/errors.js';
import { RulesConfigPort } from '../ports/config/rules-config.port.js';
import { RideMuteRepositoryPort } from '../ports/live/ride-mute.repository.port.js';
import { RideRepositoryPort } from '../ports/rides/ride.repository.port.js';

/** Who may post what into a ride's live feed – the one gate for chat lines, mock donations and paid donation orders. Reads only: no lock. */
@Injectable()
export class LiveAccessService {
  constructor(
    private readonly rides: RideRepositoryPort,
    private readonly mutes: RideMuteRepositoryPort,
    private readonly rules: RulesConfigPort,
  ) {}

  /** A started ride of someone else, on the air, with the feature on (LIVE_* flags for this ride), and the wallet not muted by its driver. */
  async requirePostable(rideId: string, wallet: string, input: { kind: 'message' } | { kind: 'donation'; effect: EffectId }, now: Date): Promise<{ ride: Ride; features: LiveFeaturesDto }> {
    const ride = await this.rides.findById(rideId);
    if (!ride || !ride.startedAt) throw new NotFoundError('ride not found');
    if (ride.isFree) throw new ForbiddenError('stream watching and interactions are not available on free rides', 'free_ride_no_stream');
    if (ride.wallet === wallet) throw new ForbiddenError('this is your own ride – spectators write here', 'own_ride');
    if (!ride.isInStatus(RideStatus.Running) || ride.isStaleRunning(now, this.rules.get())) throw new ConflictError(`the ride is ${ride.isInStatus(RideStatus.Running) ? 'off the air' : ride.status}`, 'ride_not_live');
    const features = liveFeatures(this.rules.get().live, ride);
    const refused = refusalFor(features, input);
    if (refused) throw new ForbiddenError(refused, 'live_feature_off');
    if (await this.mutes.isMuted(rideId, wallet)) throw new ForbiddenError('the driver muted you on this ride', 'muted');
    return { ride, features };
  }
}
