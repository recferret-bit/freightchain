import { VerifySgtHandler } from '../../src/application/trust/sgt.handler.js';
import { SgtOwnershipPort, SgtRepositoryPort } from '../../src/application/trust/sgt.port.js';
import { PlayerRepositoryPort } from '../../src/application/ports/players/player.repository.port.js';
import { PrismaService } from '../../src/infrastructure/prisma/prisma.service.js';
import type { Harness } from './harness.js';
import { bindClient } from './client.js';
export function sgtConcurrencyScenarios(h: () => Harness): void {
  it('concurrent wallets cannot reuse one device and concurrent retries cannot create another award', async () => {
    const { login } = bindClient(h), a = await login(), b = await login(), api = h().app;
    const proof = vi.spyOn(api.get(SgtOwnershipPort), 'verify').mockResolvedValue([{ mint: 'shared-device', slot: 100 }]);
    try {
      const handler = api.get(VerifySgtHandler);
      const result = await Promise.allSettled([handler.execute({ wallet: a.address }), handler.execute({ wallet: b.address })]);
      expect(result.filter(r => r.status === 'fulfilled')).toHaveLength(1);
      expect(result.filter(r => r.status === 'rejected')).toHaveLength(1);
      const claims = await api.get(PrismaService).sgtTrustClaim.findMany(); expect(claims).toHaveLength(1);
      const winner = claims[0].wallet, players = api.get(PlayerRepositoryPort), player = (await players.findByWallet(winner))!;
      player.applyTrustEvent('rejected'); await players.save(player);
      const retries = await Promise.all([handler.execute({ wallet: winner }), handler.execute({ wallet: winner })]);
      expect(retries.map(r => r.trustScore)).toEqual([85, 85]);
      expect(await api.get(PrismaService).sgtTrustClaim.count()).toBe(1);
    } finally { proof.mockRestore(); }
  });
  it('failed score persistence rolls back the device claim, allowing an honest retry', async () => {
    const rider = await bindClient(h).login(), api = h().app;
    const proof = vi.spyOn(api.get(SgtOwnershipPort), 'verify').mockResolvedValue([{ mint: 'rollback-device', slot: 100 }]);
    const save = vi.spyOn(api.get(PlayerRepositoryPort), 'save').mockRejectedValueOnce(new Error('write failed'));
    try {
      await expect(api.get(VerifySgtHandler).execute({ wallet: rider.address })).rejects.toThrow('write failed');
      expect(await api.get(SgtRepositoryPort).byWallet(rider.address)).toBeNull();
      expect((await api.get(PlayerRepositoryPort).findByWallet(rider.address))?.trustScore).toBe(60);
      expect((await api.get(VerifySgtHandler).execute({ wallet: rider.address })).trustScore).toBe(100);
    } finally { proof.mockRestore(); save.mockRestore(); }
  });
}
