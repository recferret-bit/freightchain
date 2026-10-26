import { Injectable } from '@nestjs/common';
import { emptyFundingEvidence, emptyNetworkEvidence, type FundingEvidence, type NetworkEvidence } from '../../domain/trust/evidence.js';
import { FundingEvidencePort } from '../ports/trust/funding-evidence.port.js';
import { NetworkEvidencePort } from '../ports/trust/network-evidence.port.js';
import { GameSettingsService } from './game-settings.service.js';

/** Explicit provider opt-ins; all outputs remain review-only and never write a score. */
@Injectable()
export class TrustEvidenceService {
  constructor(private readonly settings: GameSettingsService, private readonly network: NetworkEvidencePort, private readonly funding: FundingEvidencePort) {}
  async networkOf(ipHash: string | null, ip: string | null): Promise<NetworkEvidence> {
    if ((await this.settings.current()).trustNetworkEvidenceEnabled !== 1) return emptyNetworkEvidence('disabled');
    if (!ipHash) return emptyNetworkEvidence('unavailable');
    return this.network.lookup(ip);
  }
  async fundingOf(wallet: string): Promise<FundingEvidence> {
    if ((await this.settings.current()).trustFundingEvidenceEnabled !== 1) return emptyFundingEvidence('disabled');
    return this.funding.lookup(wallet);
  }
}
