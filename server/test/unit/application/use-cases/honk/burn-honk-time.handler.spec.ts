import type { HonkChainTx } from '../../../../../src/domain/honk/chain-tx.js';
import { RideEvent } from '../../../../../src/domain/live/ride-event.entity.js';
import { HONK_TIME_BURN } from '../../../../../src/domain/honk/tokenomics.js';
import { TooManyRequestsError } from '../../../../../src/domain/shared/errors.js';
import { HonkChainPort } from '../../../../../src/application/ports/honk/honk-chain.port.js';
import { BurnHonkTimeCommand, BurnHonkTimeHandler } from '../../../../../src/application/use-cases/honk/burn-honk-time.handler.js';
import { unitContext, unitRules } from '../../../../support/unit-context.js';

const U = 1_000_000n;

class OffHonkChain extends HonkChainPort {
  programId(): string | null { return null; }
  load(): Promise<HonkChainTx | null> { return Promise.reject(new Error('chain should stay off')); }
}

class ScriptedHonkChain extends HonkChainPort {
  constructor(private readonly tx: HonkChainTx | null) { super(); }
  programId(): string | null { return 'GctCYSHbCnHN8sE1LjUL9cmSpFd5mcVdfaumRcaVWZZx'; }
  load(): Promise<HonkChainTx | null> { return Promise.resolve(this.tx); }
}

describe('BurnHonkTimeHandler', () => {
  const setup = async (balance = 30n * U, rules = unitRules(), chain: HonkChainPort = new OffHonkChain()) => {
    const ctx = unitContext(rules);
    const ride = await ctx.paidRide('driver');
    await ctx.player('fan');
    if (balance > 0n) await ctx.honkRepo.credit('fan', balance, ctx.now());
    const handler = new BurnHonkTimeHandler(ctx.liveAccess, ctx.players, ctx.honkRepo, ctx.rideEvents, ctx.transactions, ctx.clock, ctx.entropy, chain);
    const burn = (phase: 'day' | 'night' = 'night', signature?: string) => handler.execute(new BurnHonkTimeCommand('fan', ride.id, phase, signature));
    return { ctx, ride, handler, burn };
  };

  it('burns 10 HONK and posts a honk night line, not a donation', async () => {
    const { ctx, ride, burn } = await setup();
    expect(await burn('night')).toEqual({ balance: '20', pays: '10', phase: 'night' });
    expect(await ctx.honkRepo.balance('fan')).toBe(20n * U);
    expect([...ctx.db.honkBurns.values()]).toEqual([expect.objectContaining({ wallet: 'fan', amount: HONK_TIME_BURN, kind: 'time', ref: `${ride.id}:night` })]);
    const row = ctx.db.rideEvents.find((e) => e.rideId === ride.id);
    expect(row).toMatchObject({ kind: 'honk', effect: 'night', lamports: 0, text: 'Burned 10 TEN4', slotKey: 'fx', signature: null, applied: null });
    expect(RideEvent.restore(row!).needsGame).toBe(true);
    expect(ctx.db.rideEvents.some((e) => e.kind === 'donation')).toBe(false);
  });

  it('not enough HONK is honk_balance and posts nothing', async () => {
    const { ctx, burn } = await setup(9n * U);
    await expect(burn()).rejects.toMatchObject({ errorCode: 'honk_balance' });
    expect(await ctx.honkRepo.balance('fan')).toBe(9n * U);
    expect(ctx.db.honkBurns.size).toBe(0);
    expect(ctx.db.rideEvents).toHaveLength(0);
  });

  it('a second change inside the effect window refunds and is too many requests', async () => {
    const { ctx, burn } = await setup();
    expect(await burn('night')).toMatchObject({ balance: '20', phase: 'night' });
    const before = await ctx.honkRepo.balance('fan');
    await expect(burn('day')).rejects.toBeInstanceOf(TooManyRequestsError);
    expect(await ctx.honkRepo.balance('fan')).toBe(before);
    expect(ctx.db.honkBurns.size).toBe(1);
    expect(ctx.db.rideEvents.filter((e) => e.kind === 'honk')).toHaveLength(1);
    expect(ctx.db.rideEvents.some((e) => e.kind === 'donation')).toBe(false);
  });

  it('a free ride refuses before any debit; donation effects being off does not', async () => {
    const { ctx } = await setup();
    const free = await ctx.freeRide('other', true);
    const refused = new BurnHonkTimeHandler(ctx.liveAccess, ctx.players, ctx.honkRepo, ctx.rideEvents, ctx.transactions, ctx.clock, ctx.entropy, new OffHonkChain());
    await expect(refused.execute(new BurnHonkTimeCommand('fan', free.id, 'day'))).rejects.toMatchObject({ errorCode: 'free_ride_no_stream' });
    expect(await ctx.honkRepo.balance('fan')).toBe(30n * U);
    expect(ctx.db.honkBurns.size).toBe(0);
    expect(ctx.db.rideEvents).toHaveLength(0);

    const off = unitContext(unitRules({ live: { chat: 'off', donations: false, freeDonations: false, effects: 'off' } }));
    const ride = await off.paidRide('driver');
    await off.player('fan');
    await off.honkRepo.credit('fan', 30n * U, off.now());
    const handler = new BurnHonkTimeHandler(off.liveAccess, off.players, off.honkRepo, off.rideEvents, off.transactions, off.clock, off.entropy, new OffHonkChain());
    expect(await handler.execute(new BurnHonkTimeCommand('fan', ride.id, 'night'))).toMatchObject({ balance: '20', pays: '10', phase: 'night' });
    expect(off.db.rideEvents.filter((e) => e.kind === 'honk')).toHaveLength(1);
    expect(off.db.rideEvents.some((e) => e.kind === 'donation')).toBe(false);
  });

  it('a program id requires a confirmed burn of exactly 10 HONK, and a bad one does not debit', async () => {
    const bad = await setup(30n * U, unitRules(), new ScriptedHonkChain({ signers: ['fan'], burns: [{ amount: U, authority: 'fan' }], parts: [] }));
    await expect(bad.burn('night', 'sig')).rejects.toMatchObject({ errorCode: 'bad_signature' });
    expect(await bad.ctx.honkRepo.balance('fan')).toBe(30n * U);
    expect(bad.ctx.db.honkBurns.size).toBe(0);
    const ok = await setup(30n * U, unitRules(), new ScriptedHonkChain({ signers: ['fan'], burns: [{ amount: 10n * U, authority: 'fan' }], parts: [] }));
    expect(await ok.burn('night', 'sig')).toMatchObject({ balance: '20', pays: '10', phase: 'night' });
  });
});
