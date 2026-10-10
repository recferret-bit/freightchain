import { QueryHandler, type IQueryHandler } from '@nestjs/cqrs';
import { offlineAllowance, offlineIp } from '../../../../domain/offline/offline-ride.js';
import { RulesConfigPort } from '../../../ports/config/rules-config.port.js';
import { OfflineRideRepositoryPort } from '../../../ports/offline/offline-ride.repository.port.js';
import { GameSettingsService } from '../../../services/game-settings.service.js';
import type { OfflineRideDto } from '../claim-offline-ride/claim-offline-ride.command.js';
import { GetOfflineRidesQuery } from './get-offline-rides.query.js';

/** How many anonymous free runs this browser and this address still have. Does not spend one. */
@QueryHandler(GetOfflineRidesQuery)
export class GetOfflineRidesHandler implements IQueryHandler<GetOfflineRidesQuery, OfflineRideDto> {
  constructor(
    private readonly offline: OfflineRideRepositoryPort,
    private readonly settings: GameSettingsService,
    private readonly rules: RulesConfigPort,
  ) {}

  async execute({ wallet, fingerprint, ip }: GetOfflineRidesQuery): Promise<OfflineRideDto> {
    const settings = await this.settings.current();
    const counts = await this.offline.counts(fingerprint, offlineIp(ip));
    return offlineAllowance({
      signedIn: wallet !== null, claimed: false, ...counts,
      limitFingerprint: settings.offlineFreeRides, limitIp: settings.offlineFreeRidesPerIp,
      minSeconds: this.rules.get().freeRideSeconds,
    });
  }
}
