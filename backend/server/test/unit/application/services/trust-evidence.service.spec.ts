import { TrustEvidenceService } from '../../../../src/application/services/trust-evidence.service.js';
import { GameSettingsService } from '../../../../src/application/services/game-settings.service.js';
import { unitContext } from '../../../support/unit-context.js';
import { emptyNetworkEvidence, emptyFundingEvidence } from '../../../../src/domain/trust/evidence.js';
describe('TrustEvidenceService', () => {
  it('credentials cannot opt in; defaults issue no external calls, and a missing privacy hash disables lookup', async () => {
    const ctx = unitContext(), network = { lookup: vi.fn().mockResolvedValue(emptyNetworkEvidence('observed')) }, funding = { lookup: vi.fn().mockResolvedValue(emptyFundingEvidence('not_found')) };
    const service = new TrustEvidenceService(new GameSettingsService(ctx.settingsRepo), network, funding);
    expect((await service.networkOf('hash', '8.8.8.8')).status).toBe('disabled');
    expect((await service.fundingOf('wallet')).status).toBe('disabled');
    expect(network.lookup).not.toHaveBeenCalled(); expect(funding.lookup).not.toHaveBeenCalled();
    await ctx.settingsRepo.upsert('trust_network_evidence_enabled', 1);
    expect((await service.networkOf(null, '8.8.8.8')).status).toBe('unavailable');
    expect(network.lookup).not.toHaveBeenCalled();
    await service.networkOf('hash', '8.8.8.8'); expect(network.lookup).toHaveBeenCalledWith('8.8.8.8');
    await ctx.settingsRepo.upsert('trust_funding_evidence_enabled', 1);
    expect((await service.fundingOf('wallet')).status).toBe('not_found');
    expect(ctx.db.players.size).toBe(0);
  });
});
