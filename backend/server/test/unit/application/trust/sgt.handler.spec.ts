import { GetSgtHandler, VerifySgtHandler } from '../../../../src/application/trust/sgt.handler.js';
import { SgtOwnershipPort } from '../../../../src/application/trust/sgt.port.js';
import { Player } from '../../../../src/domain/players/player.entity.js';
import { MemorySgtRepository } from '../../../support/in-memory/memory-sgt.js';
import { MemoryDb } from '../../../support/in-memory/memory-db.js';
import { MemoryPlayerRepository, MemoryTransaction } from '../../../support/in-memory/memory-repositories.js';
import { FakeClock } from '../../../support/fake-clock.js';

function setup() {
  const claims = new MemorySgtRepository(), players = new MemoryPlayerRepository(new MemoryDb()), clock = new FakeClock();
  const ownership: SgtOwnershipPort = { enabled: () => true, verify: vi.fn(async () => [{ mint: 'device', slot: 1 }]) };
  return { claims, players, clock, ownership, handler: new VerifySgtHandler(ownership, claims, players, new MemoryTransaction(), clock), query: new GetSgtHandler(ownership, claims, players) };
}
describe('SGT trust fast path', () => {
  it('awards once and a retry never restores later penalties or reads the provider', async () => {
    const c = setup(); await c.players.insertIfAbsent(Player.register('a', c.clock.now(), 0, 0));
    expect(await c.query.execute({ wallet: 'a' })).toMatchObject({ enabled: true, claimed: false, trustScore: 60 });
    expect(await c.handler.execute({ wallet: 'a' })).toMatchObject({ claimed: true, trustScore: 100 });
    const p = (await c.players.findByWallet('a'))!; p.applyTrustEvent('rejected'); await c.players.save(p);
    expect(await c.handler.execute({ wallet: 'a' })).toMatchObject({ claimed: true, trustScore: 85 });
    expect(c.ownership.verify).toHaveBeenCalledTimes(1);
  });
  it('a transferred claimed device cannot award another wallet; a different unclaimed device can', async () => {
    const c = setup(); for (const w of ['a', 'b']) await c.players.insertIfAbsent(Player.register(w, c.clock.now(), 0, 0));
    await c.handler.execute({ wallet: 'a' });
    await expect(c.handler.execute({ wallet: 'b' })).rejects.toMatchObject({ errorCode: 'sgt_already_used' });
    expect((await c.players.findByWallet('b'))?.trustScore).toBe(60);
    vi.mocked(c.ownership.verify).mockResolvedValue([{ mint: 'device', slot: 1 }, { mint: 'second-device', slot: 2 }]);
    expect(await c.handler.execute({ wallet: 'b' })).toMatchObject({ claimed: true, trustScore: 100 });
  });
  it('rejects guests, missing players and absent assets without a credit', async () => {
    const c = setup(); await c.players.insertIfAbsent(Player.register('guest', c.clock.now(), 0, 0, true));
    await expect(c.handler.execute({ wallet: 'guest' })).rejects.toMatchObject({ errorCode: 'sgt_wallet_required' });
    await expect(c.query.execute({ wallet: 'guest' })).rejects.toMatchObject({ errorCode: 'sgt_wallet_required' });
    await expect(c.handler.execute({ wallet: 'missing' })).rejects.toMatchObject({ errorCode: 'not_found' });
    await c.players.insertIfAbsent(Player.register('a', c.clock.now(), 0, 0)); vi.mocked(c.ownership.verify).mockResolvedValue([]);
    await expect(c.handler.execute({ wallet: 'a' })).rejects.toMatchObject({ errorCode: 'sgt_not_held' });
    expect(c.claims.rows.size).toBe(0);
  });
});
