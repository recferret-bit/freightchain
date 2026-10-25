import { ReleaseHonkHandler } from '../../../../../src/application/use-cases/honk/release-honk.handler.js';
import { HonkMintService } from '../../../../../src/application/services/honk-mint.service.js';
import { ReleaseHonkCommand } from '../../../../../src/application/use-cases/honk/release-honk.command.js';
import { HonkEmissionPort } from '../../../../../src/application/ports/honk/honk-emission.port.js';
import { dayIndex } from '../../../../../src/domain/honk/tokenomics.js';
import { unitContext } from '../../../../support/unit-context.js';

const U = 1_000_000n;

class RecordingEmission extends HonkEmissionPort {
  readonly calls: { rideId: string; wallet: string; tier: string; bands: number; dayIndex: number }[] = [];
  enabled(): boolean { return true; }
  async mint(rideId: string, wallet: string, tier: string, bands: number, dayIndex: number): Promise<void> {
    this.calls.push({ rideId, wallet, tier, bands, dayIndex });
  }
}

describe('ReleaseHonkHandler', () => {
  it('TEN-T-08 credits a held 8h mint once the 48h have passed, and calls the chain after', async () => {
    const ctx = unitContext();
    await ctx.player('w');
    const emission = new RecordingEmission();
    ctx.honkMint = new HonkMintService(ctx.honkRepo, ctx.clock, emission);
    const handler = new ReleaseHonkHandler(ctx.honkRepo, ctx.honkMint, ctx.players, ctx.transactions, emission, ctx.clock);
    expect(await ctx.honkMint.credit({ rideId: 'r8', wallet: 'w', tier: '8h', distance: 10_000, completeDist: 10_000 })).toBeNull();
    expect(await handler.execute(new ReleaseHonkCommand())).toBe(0);
    expect(emission.calls).toEqual([]);
    ctx.clock.advance(48 * 3600);
    expect(await handler.execute(new ReleaseHonkCommand())).toBe(1);
    expect(await ctx.honkRepo.balance('w')).toBe(1200n * U);
    expect(emission.calls).toEqual([{ rideId: 'r8', wallet: 'w', tier: '8h', bands: 0b111, dayIndex: dayIndex(ctx.clock.now()) }]);
    expect(await handler.execute(new ReleaseHonkCommand())).toBe(0);
    expect(emission.calls).toHaveLength(1);
  });

  it('skips a wallet that has no player row', async () => {
    const ctx = unitContext();
    const emission = new RecordingEmission();
    ctx.honkMint = new HonkMintService(ctx.honkRepo, ctx.clock, emission);
    const handler = new ReleaseHonkHandler(ctx.honkRepo, ctx.honkMint, ctx.players, ctx.transactions, emission, ctx.clock);
    await ctx.honkMint.credit({ rideId: 'gone', wallet: 'missing', tier: '8h', distance: 10_000, completeDist: 10_000 });
    ctx.clock.advance(48 * 3600);
    expect(await handler.execute(new ReleaseHonkCommand())).toBe(0);
    expect(await ctx.honkRepo.findMint('gone')).toMatchObject({ released: false });
    expect(emission.calls).toEqual([]);
  });

  it('TEN-T-08 cancels a pending 8h reservation whose verdict is no longer verified and survives chain RPC errors', async () => {
    const ctx = unitContext();
    await ctx.player('w');
    const emission = new RecordingEmission();
    ctx.honkMint = new HonkMintService(ctx.honkRepo, ctx.clock, emission);
    emission.mint = async () => { throw new Error('rpc down'); };
    const handler = new ReleaseHonkHandler(ctx.honkRepo, ctx.honkMint, ctx.players, ctx.transactions, emission, ctx.clock, ctx.verdictRepo);
    await ctx.honkMint.credit({ rideId: 'bad-8h', wallet: 'w', tier: '8h', distance: 10_000, completeDist: 10_000 });
    await ctx.honkMint.credit({ rideId: 'ok-8h', wallet: 'w', tier: '8h', distance: 10_000, completeDist: 10_000 });
    ctx.db.verdicts.set('bad-8h', {
      rideId: 'bad-8h', status: 'rejected' as never, reasons: [], scores: {} as never,
      rulesVersion: 1, judgedAt: ctx.now(), overriddenBy: 'admin', overriddenAt: ctx.now(), note: null, version: 1,
    });
    ctx.clock.advance(48 * 3600);
    expect(await handler.execute(new ReleaseHonkCommand())).toBe(1);
    expect(await ctx.honkRepo.findMint('bad-8h')).toBeNull();
    expect(await ctx.honkRepo.findMint('ok-8h')).toMatchObject({ released: true });
    expect(await ctx.honkRepo.balance('w')).toBe(800n * U);
  });
  it('retries an immediate reward after failure and worker restart without crediting the ledger twice', async () => {
    const ctx = unitContext();
    await ctx.player('w');
    const emission = new RecordingEmission();
    ctx.honkMint = new HonkMintService(ctx.honkRepo, ctx.clock, emission);
    await ctx.honkMint.credit({ rideId: 'retry', wallet: 'w', tier: '1h', distance: 100, completeDist: 100 });
    const send = vi.spyOn(emission, 'mint').mockRejectedValueOnce(new Error('lost RPC response'));
    const worker = () => new ReleaseHonkHandler(ctx.honkRepo, ctx.honkMint, ctx.players, ctx.transactions, emission, ctx.clock);
    await worker().execute(new ReleaseHonkCommand());
    expect(await ctx.honkRepo.findMint('retry')).toMatchObject({ chainPending: true });
    await worker().execute(new ReleaseHonkCommand());
    expect(send).toHaveBeenCalledTimes(1);
    ctx.clock.advance(121);
    await worker().execute(new ReleaseHonkCommand());
    expect(send).toHaveBeenCalledTimes(2);
    expect(send).toHaveBeenLastCalledWith('retry', 'w', '1h', 7, dayIndex(ctx.now()), 100n * U);
    expect(await ctx.honkRepo.findMint('retry')).toMatchObject({ chainPending: false, chainSentAt: ctx.now() });
    await worker().execute(new ReleaseHonkCommand());
    expect(send).toHaveBeenCalledTimes(2);
    expect(await ctx.honkRepo.balance('w')).toBe(100n * U);
  });

  it('does not retroactively mint ledger-only credits when an emitter is configured later', async () => {
    const ctx = unitContext();
    await ctx.player('w');
    await ctx.honkMint.credit({ rideId: 'points', wallet: 'w', tier: '1h', distance: 100, completeDist: 100 });
    const emission = new RecordingEmission();
    await new ReleaseHonkHandler(ctx.honkRepo, ctx.honkMint, ctx.players, ctx.transactions, emission, ctx.clock).execute(new ReleaseHonkCommand());
    expect(emission.calls).toEqual([]);
  });

});
