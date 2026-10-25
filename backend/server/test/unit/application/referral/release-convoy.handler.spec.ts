import { ReleaseConvoyHandler } from '../../../../src/application/referral/release-convoy.handler.js';
import { ReleaseConvoyCommand } from '../../../../src/application/referral/release-convoy.command.js';
import type { ReferralEmissionPort, ReferralPayment, ReferralSettlement } from '../../../../src/application/ports/honk/referral-emission.port.js';
import { MemoryConvoyRepository } from '../../../../src/infrastructure/social/memory-convoy.repository.js';
import { Player } from '../../../../src/domain/players/player.entity.js';
import { unitContext } from '../../../support/unit-context.js';

async function harness() {
  const ctx = unitContext(), repo = new MemoryConvoyRepository();
  await ctx.player('a'); await ctx.player('b');
  await repo.insertLedger({ id: 'convoy:m1:b', kind: 'm1', wallet: 'a', referrer: 'a', referee: 'b', amount: 100, unit: 'ten4', at: ctx.now(), dayKey: 'd', weekKey: 'w', chainState: 'held', releasedAt: null });
  const settle = vi.fn(async (p: ReferralPayment): Promise<ReferralSettlement> => { await p.onSubmitted({ signature: 'signed', lastValidBlockHeight: 12 }); return { kind: 'paid', amount: 50_000_000n }; });
  const emission: ReferralEmissionPort = { enabled: () => true, settle };
  const worker = () => new ReleaseConvoyHandler(repo, ctx.players, ctx.transactions, emission, ctx.honkRepo, ctx.clock, ctx.entropy);
  const run = () => worker().execute(new ReleaseConvoyCommand());
  return { ctx, repo, settle, emission, run };
}

describe('ReleaseConvoyHandler', () => {
  it('continues to healthy rewards after a player-lock failure and retries the failed reward later', async () => {
    const h = await harness();
    await h.ctx.player('c');
    const row = (await h.repo.findLedger('convoy:m1:b'))!;
    await h.repo.insertLedger({ ...row, id: 'convoy:m1:c', referee: 'c' });
    h.ctx.clock.advance(48 * 3600);
    const lock = vi.spyOn(h.ctx.players, 'findByWalletForUpdate').mockRejectedValueOnce(new Error('transient lock failure'));
    expect(await h.run()).toBe(1);
    expect((await h.repo.findLedger('convoy:m1:b'))?.chainState).toBe('held');
    expect((await h.repo.findLedger('convoy:m1:c'))?.chainState).toBe('paid');
    lock.mockRestore();
    expect(await h.run()).toBe(1);
    expect(await h.ctx.honkRepo.balance('a')).toBe(100_000_000n);
    expect(await h.run()).toBe(0);
  });

  it('holds for 48h then credits the clipped on-chain amount once, without requiring another ride', async () => {
    const h = await harness();
    expect(await h.run()).toBe(0);
    h.ctx.clock.advance(48 * 3600 - 1);
    expect(await h.run()).toBe(0);
    h.ctx.clock.advance(1);
    expect(await h.run()).toBe(1);
    expect(await h.ctx.honkRepo.balance('a')).toBe(50_000_000n);
    expect(await h.repo.findLedger('convoy:m1:b')).toMatchObject({ chainState: 'paid', paidUnits: 50_000_000n, releasedAt: h.ctx.now(), chainSignature: 'signed' });
    expect(await h.run()).toBe(0);
    expect(h.settle).toHaveBeenCalledOnce();
  });

  it('persists the submission before RPC, survives lost response and recovers after a worker restart', async () => {
    const h = await harness();
    h.ctx.clock.advance(48 * 3600);
    h.settle.mockImplementationOnce(async (p) => {
      await p.onSubmitted({ signature: 'landed', lastValidBlockHeight: 123 });
      expect(await h.repo.findLedger(p.rewardId)).toMatchObject({ chainSignature: 'landed', chainLastValidBlockHeight: 123 });
      throw new Error('lost response');
    });
    expect(await h.run()).toBe(0);
    expect(await h.ctx.honkRepo.balance('a')).toBe(0n);
    expect(await h.run()).toBe(0);
    expect(h.settle).toHaveBeenCalledOnce();
    h.ctx.clock.advance(121);
    h.settle.mockImplementationOnce(async (p) => { expect(p.submitted).toEqual({ signature: 'landed', lastValidBlockHeight: 123 }); return { kind: 'paid', amount: 100_000_000n }; });
    expect(await h.run()).toBe(1);
    expect(await h.ctx.honkRepo.balance('a')).toBe(100_000_000n);
    expect(await h.run()).toBe(0);
  });

  it('rechecks both trust scores and refusals, and never submits legacy ledger rows', async () => {
    const h = await harness();
    h.ctx.clock.advance(48 * 3600);
    const player = (await h.ctx.players.findByWallet('b'))!;
    await h.ctx.players.save(Player.restore({ ...player.snapshot(), trustScore: 49 }));
    expect(await h.run()).toBe(0);
    expect(h.settle).not.toHaveBeenCalled();
    h.ctx.clock.advance(121);
    await h.ctx.players.save(Player.restore({ ...(await h.ctx.players.findByWallet('b'))!.snapshot(), trustScore: 60, rejectedRides: 1 }));
    expect(await h.run()).toBe(0);
    expect(h.settle).not.toHaveBeenCalled();
    await h.repo.insertLedger({ id: 'old', kind: 'm2', wallet: 'a', referrer: 'a', referee: 'b', amount: 50, unit: 'ten4', at: new Date(0), dayKey: 'd', weekKey: 'w', releasedAt: new Date(1) });
    h.ctx.clock.advance(121);
    await h.ctx.players.save(Player.restore({ ...(await h.ctx.players.findByWallet('b'))!.snapshot(), trustScore: 60, rejectedRides: 0 }));
    expect(await h.run()).toBe(1);
    expect(h.settle).toHaveBeenCalledOnce();
  });

  it.each(['monthly', 'wallet', 'emission'] as const)('records a confirmed %s cap as terminal with no credit or future backlog', async (reason) => {
    const h = await harness();
    h.ctx.clock.advance(48 * 3600);
    h.settle.mockResolvedValue({ kind: 'capped', reason });
    expect(await h.run()).toBe(0);
    expect(await h.repo.findLedger('convoy:m1:b')).toMatchObject({ chainState: 'capped', capReason: reason, paidUnits: 0n, releasedAt: null });
    h.ctx.clock.advance(32 * 86400);
    expect(await h.run()).toBe(0);
    expect(h.settle).toHaveBeenCalledOnce();
    expect(await h.ctx.honkRepo.balance('a')).toBe(0n);
  });

  it('refuses a stale worker submission when another lease has taken ownership', async () => {
    const h = await harness();
    h.ctx.clock.advance(48 * 3600);
    h.settle.mockImplementationOnce(async (p) => {
      const row = (await h.repo.findLedger(p.rewardId))!;
      await h.ctx.transactions.run((tx) => h.repo.saveSettlement({ ...row, chainLeaseId: 'replacement' }, row.chainLeaseId!, tx));
      await expect(p.onSubmitted({ signature: 'must-not-send', lastValidBlockHeight: 100 })).rejects.toThrow('lease lost');
      throw new Error('not broadcast');
    });
    expect(await h.run()).toBe(0);
    expect(await h.ctx.honkRepo.balance('a')).toBe(0n);
    expect((await h.repo.findLedger('convoy:m1:b'))?.chainSignature).toBeUndefined();
  });
});
