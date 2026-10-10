import { CommandHandler, type ICommandHandler } from '@nestjs/cqrs';
import { offlineAllowance, offlineIp } from '../../../../domain/offline/offline-ride.js';
import { ConflictError } from '../../../../domain/shared/errors.js';
import { RulesConfigPort } from '../../../ports/config/rules-config.port.js';
import { OfflineRideRepositoryPort } from '../../../ports/offline/offline-ride.repository.port.js';
import { ClockPort } from '../../../ports/shared/clock.port.js';
import { EntropyPort } from '../../../ports/shared/entropy.port.js';
import { GameSettingsService } from '../../../services/game-settings.service.js';
import { ClaimOfflineRideCommand, type OfflineRideDto } from './claim-offline-ride.command.js';

/** A signed-in wallet is sent on without burning a credit. A spent bucket is a 409; the row is inserted only when both buckets still have room. */
@CommandHandler(ClaimOfflineRideCommand)
export class ClaimOfflineRideHandler implements ICommandHandler<ClaimOfflineRideCommand, OfflineRideDto> {
  constructor(
    private readonly offline: OfflineRideRepositoryPort,
    private readonly settings: GameSettingsService,
    private readonly rules: RulesConfigPort,
    private readonly clock: ClockPort,
    private readonly entropy: EntropyPort,
  ) {}

  async execute({ wallet, fingerprint, ip }: ClaimOfflineRideCommand): Promise<OfflineRideDto> {
    const limits = await this.limits();
    const addr = offlineIp(ip);
    if (wallet) {
      const counts = await this.offline.counts(fingerprint, addr);
      return offlineAllowance({ signedIn: true, claimed: false, ...counts, ...limits });
    }
    const result = await this.offline.tryClaim({
      id: this.entropy.uuid(), fingerprint, ip: addr, at: this.clock.now(),
      limitFingerprint: limits.limitFingerprint, limitIp: limits.limitIp,
    });
    if (!result.granted) throw new ConflictError('offline free rides are used up', 'offline_rides_spent');
    return offlineAllowance({ signedIn: false, claimed: true, usedFingerprint: result.usedFingerprint, usedIp: result.usedIp, ...limits });
  }

  private async limits(): Promise<{ limitFingerprint: number; limitIp: number; minSeconds: number }> {
    const settings = await this.settings.current();
    return { limitFingerprint: settings.offlineFreeRides, limitIp: settings.offlineFreeRidesPerIp, minSeconds: this.rules.get().freeRideSeconds };
  }
}
