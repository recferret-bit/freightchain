import { AnswerMinigameHandler, GetMinigameAssetHandler, OpenMinigameHandler } from '../../../../../../src/application/use-cases/rides/minigames/minigames.handler.js';
import { AnswerMinigameCommand, GetMinigameAssetQuery, OpenMinigameCommand } from '../../../../../../src/application/use-cases/rides/minigames/minigames.command.js';
import { MinigameConfigPort } from '../../../../../../src/application/ports/minigames/minigame-config.port.js';
import { RideMiniGameRepositoryPort } from '../../../../../../src/application/ports/minigames/ride-minigame.repository.port.js';
import { MinigameRateService } from '../../../../../../src/application/services/minigame-rate.service.js';
import { MinigameSessionService } from '../../../../../../src/application/services/minigame-session.service.js';
import { RideMiniGame } from '../../../../../../src/domain/minigames/ride-minigame.js';
import { NodeMinigameCrypto } from '../../../../../../src/infrastructure/crypto/node.minigame-crypto.js';
import { unitContext, unitRules } from '../../../../../support/unit-context.js';

class FixedMg extends MinigameConfigPort {
  mode() { return 'shadow' as const; }
  saltVersion() { return 'mg:v1'; }
  secret() { return 's'.repeat(32); }
}

class MemoryMinigames extends RideMiniGameRepositoryPort {
  rows: RideMiniGame[] = [];
  private copy(row: RideMiniGame) { return RideMiniGame.restore(row.snapshot()); }
  async listByRide(rideId: string) { return this.rows.filter((r) => r.rideId === rideId).map((r) => this.copy(r)); }
  async findById(id: string) { const hit = this.rows.find((r) => r.id === id); return hit ? this.copy(hit) : null; }
  async insert(row: RideMiniGame) {
    const existing = this.rows.find((r) => r.rideId === row.rideId && r.ordinal === row.ordinal);
    if (existing) return this.copy(existing);
    this.rows.push(this.copy(row));
    return this.copy(row);
  }
  async save(row: RideMiniGame) { this.rows[this.rows.findIndex((r) => r.id === row.id)] = this.copy(row); }
}

describe('minigame handlers', () => {
  it('open, answer and asset go through the session', async () => {
    const ctx = unitContext(unitRules({ hbTimeoutMs: 10_000_000 }));
    const session = new MinigameSessionService(new FixedMg(), new NodeMinigameCrypto(), new MemoryMinigames(), ctx.rides, ctx.players, ctx.lookup, ctx.transactions, ctx.clock, new MinigameRateService());
    let ride = await ctx.paidOrder('w');
    ride.markPaid(1, ctx.now());
    await session.stamp(ride, 'normal', 'en');
    ride.start(ctx.now());
    ride = await ctx.rides.save(ride);
    ctx.clock.advance(3419.999);
    ride.applyReport({ s: 40, t: 3419.999, hull: 100, paused: false, night: false, crashesVehicle: null, crashesBuilding: null }, ctx.now(), ctx.rules.get());
    await session.sync(ride, ctx.now());
    await ctx.rides.save(ride);
    const ev = (await session.view(ride))![0]!;
    const mac = 'B'.repeat(43);
    const opened = await new OpenMinigameHandler(session).execute(new OpenMinigameCommand('w', ride.id, ev.id, mac, 0, true));
    expect(opened.kind).toBe('phone-sms');
    expect(opened.nonce).toMatch(/^[0-9a-f]{16}$/);
    const svg = await new GetMinigameAssetHandler(session).execute(new GetMinigameAssetQuery('w', ride.id, ev.id, opened.layout.cab[0]!.assetId));
    expect(svg.startsWith('<svg ')).toBe(true);
    const answered = await new AnswerMinigameHandler(session).execute(new AnswerMinigameCommand('w', ride.id, ev.id, mac, opened.nonce, 1, '000000', null));
    expect(answered.attempts).toBe(1);
    expect(answered.outcome === 'passed' || answered.outcome === 'pending').toBe(true);
  });
});
