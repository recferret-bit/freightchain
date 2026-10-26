import { EnvService } from '../../src/infrastructure/config/env.service.js';
import { SettingsRepositoryPort } from '../../src/application/ports/settings/settings.repository.port.js';
import { PlayerRepositoryPort } from '../../src/application/ports/players/player.repository.port.js';
import { SignInRepositoryPort } from '../../src/application/ports/auth/sign-in.repository.port.js';
import { bindClient } from '../support/client.js';
import { ADMIN, ADMIN_ENV } from './admin.scenarios.js';
import type { Harness } from '../support/harness.js';
export const TRUST_EVIDENCE_ENV = { ...ADMIN_ENV, TRUST_PROXY: '1' };
export function trustEvidenceScenarios(h: () => Harness): void {
  const { anon, login, loginAdmin } = bindClient(h);
  beforeEach(() => h().reset());
  it('trust evidence stays disabled despite configured provider credentials, without sending a sign-in IP', async () => {
    const env = h().app.get(EnvService), keys = [vi.spyOn(env, 'ipinfoToken', 'get').mockReturnValue('fixture'), vi.spyOn(env, 'heliusApiKey', 'get').mockReturnValue('fixture')];
    const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher);
    try {
      const guest = (await anon().post('/api/auth/guest').set('x-forwarded-for', '8.8.8.8').expect(200)).body;
      const admin = await loginAdmin(ADMIN);
      const detail = (await admin.agent.get(`/api/admin/players/${guest.wallet}`).expect(200)).body;
      expect(detail).toMatchObject({ fundingEvidence: { status: 'disabled' }, signIns: [{ network: { status: 'disabled' } }] });
      expect(fetcher).not.toHaveBeenCalled();
    } finally { keys.forEach(s => s.mockRestore()); vi.unstubAllGlobals(); }
  });
  it('opted-in evidence sanitizes network facts, excludes mobile/exchange evidence and leaves trust unchanged', async () => {
    const admin = await loginAdmin(ADMIN), rider = await login();
    const settings = h().app.get(SettingsRepositoryPort), env = h().app.get(EnvService), players = h().app.get(PlayerRepositoryPort);
    const trust = (await players.findByWallet(rider.address))!.trustScore;
    await settings.upsert('trust_network_evidence_enabled', 1); await settings.upsert('trust_funding_evidence_enabled', 1);
    const keys = [vi.spyOn(env, 'ipinfoToken', 'get').mockReturnValue('fixture'), vi.spyOn(env, 'heliusApiKey', 'get').mockReturnValue('fixture')];
    const fetcher = vi.fn(async (url: string) => new Response(JSON.stringify(url.includes('ipinfo') ? { ip: '8.8.8.8', geo: { city: 'must not persist' }, as: { asn: 'AS15169' }, is_mobile: true, is_hosting: false, is_anonymous: false } : { funder: ADMIN.address, funderType: 'exchange', amountRaw: '100000001', signature: '1'.repeat(88), slot: 1, timestamp: 1 })));
    vi.stubGlobal('fetch', fetcher);
    try {
      const guest = (await anon().post('/api/auth/guest').set('x-forwarded-for', '8.8.8.8').set('user-agent', 'never-retain-browser').expect(200)).body;
      const rows = await h().app.get(SignInRepositoryPort).recent(1, guest.wallet);
      expect(rows[0]).toMatchObject({ network: { status: 'observed', asn: 'AS15169', excluded: 'mobile' } });
      expect((await h().app.get(SignInRepositoryPort).summaryOf([guest.wallet]))[0]!.ips).toEqual([]);
      expect(JSON.stringify(rows)).not.toMatch(/8\.8\.8\.8|must not persist|never-retain-browser/);
      const detail = (await admin.agent.get(`/api/admin/players/${rider.address}`).expect(200)).body;
      expect(detail.fundingEvidence).toMatchObject({ status: 'observed', excluded: 'exchange', funder: { amountRaw: '100000001' } });
      expect((await players.findByWallet(rider.address))!.trustScore).toBe(trust);
      expect(fetcher).toHaveBeenCalledTimes(2);
    } finally { keys.forEach(s => s.mockRestore()); vi.unstubAllGlobals(); }
  });
}
