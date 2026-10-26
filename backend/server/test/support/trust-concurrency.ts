import { PlayerRepositoryPort } from '../../src/application/ports/players/player.repository.port.js';
import { TransactionPort } from '../../src/application/ports/shared/transaction.port.js';
import { bindClient } from './client.js';
import type { Harness } from './harness.js';

export function trustConcurrencyScenarios(h: () => Harness): void {
  const { login } = bindClient(h);
  it('concurrent finish days and social awards preserve distinct evidence across row locks and reloads', async () => {
    const who = await login(), players = h().app.get(PlayerRepositoryPort), transactions = h().app.get(TransactionPort);
    const initial = (await players.findByWallet(who.address))!; initial.setTrustScore(0); await players.save(initial);
    const award = (kind: string) => transactions.run(async tx => {
      const p = (await players.findByWalletForUpdate(who.address, tx))!;
      if (kind === 'x' || kind === 'telegram') p.awardSocial(kind);
      else p.awardVerifiedFinish(new Date(`${kind}T12:00:00Z`));
      await players.save(p, tx);
    });
    await Promise.all(['2026-10-19', '2026-10-19', '2026-10-20', '2026-10-21', 'x', 'telegram', 'x'].map(award));
    const saved = (await players.findByWallet(who.address))!;
    expect(saved.trustScore).toBe(55);
    expect(saved.snapshot().trustActivity?.finishDays).toHaveLength(2);
    expect(saved.snapshot().trustActivity?.socials.sort()).toEqual(['telegram', 'x']);
    await Promise.all(['2026-10-19', 'x', 'telegram'].map(award));
    expect((await players.findByWallet(who.address))?.trustScore).toBe(55);
  });
}
