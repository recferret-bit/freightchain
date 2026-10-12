import type { CommandBus } from '@nestjs/cqrs';
import { PayPoolsCommand } from '../../../../../src/application/use-cases/chain/pay-pools/pay-pools.command.js';
import { PayPoolsHandler } from '../../../../../src/application/use-cases/chain/pay-pools/pay-pools.handler.js';
import { SettleChainSignatureCommand } from '../../../../../src/application/use-cases/chain/settle-chain-signature/settle-chain-signature.command.js';
import { SettleChainSignatureHandler } from '../../../../../src/application/use-cases/chain/settle-chain-signature/settle-chain-signature.handler.js';
import { PoolAttentionService } from '../../../../../src/application/services/pool-attention.service.js';
import { AttestationService } from '../../../../../src/application/services/attestation.service.js';
import { FakePoolPayoutChain } from '../../../../support/fake-pool-payout-chain.js';
import { poolRide } from '../../../../support/pool-rides.js';
import { chainPool } from '../../../../support/pools.js';
import { unitContext } from '../../../../support/unit-context.js';
import { VerdictStatus } from '../../../../../src/domain/verdict/verdict.dto.js';

const KEY = 'Payout11111111111111111111111111111111111111';
const DAY = 86_400_000;

describe('PayPoolsHandler – the payout job', () => {
  /** pool 1 on chain: active, 10 tickets × 0.05 SOL (prize 70 % = 0.35 SOL), review window over at `payoutAt` = now; mirrored */
  const setup = async () => {
    const ctx = unitContext();
    // riders who signed up days before the pool (a brand-new wallet in the top 3 is a pool-level mark of its own – tested below)
    for (const w of ['alice', 'bob', 'carol', 'dave', 'mallory']) await ctx.player(w);
    ctx.clock.advance(3 * 86_400);
    const payout = new FakePoolPayoutChain(ctx.poolChain);
    payout.payoutAddress = KEY;
    payout.now = ctx.now();
    const t = ctx.now().getTime();
    ctx.poolChain.pools.set(1, chainPool(ctx.now(), {
      poolId: 1, status: 'active', ticketsSold: 10, minTickets: 2, priceLamports: 50_000_000, vaultLamports: 890_880 + 500_000_000, escrowLamports: 500_000_000,
      prepDeadline: new Date(t - 4 * DAY), playDeadline: new Date(t - 3 * DAY), payoutAt: new Date(t),
    }));
    await ctx.registry.syncFromChain(1);
    const settle = new SettleChainSignatureHandler(ctx.poolChain, ctx.chainEvents, ctx.ticketSettlement, ctx.registry, ctx.clock);
    const bus = { execute: async (c: object) => { if (!(c instanceof SettleChainSignatureCommand)) throw new Error('unexpected command'); return settle.execute(c); } };
    const attention = new PoolAttentionService(ctx.adminQuery, ctx.signIns, ctx.players, ctx.verdicts);
    const attestation = new AttestationService(payout, ctx.rides, ctx.batches, ctx.hasher);
    const handler = new PayPoolsHandler(payout, ctx.poolChain, ctx.pools, ctx.poolPayouts, ctx.rideQuery, ctx.chainEvents, ctx.registry, attention, bus as unknown as CommandBus, ctx.clock, attestation);
    const mirror = async () => (await ctx.pools.findById(1))!;
    return { ctx, payout, run: (poolId: number | null = null) => handler.execute(new PayPoolsCommand(poolId)), mirror };
  };

  it('without PAYOUT_SECRET it does nothing (the admin pays from the admin page)', async () => {
    const { payout, run } = await setup();
    payout.payoutAddress = null;
    expect(await run()).toEqual({ enabled: false, payout: null, refused: null, chainNow: null, pools: [] });
  });

  it('refuses to run while the program names another payout key – or none', async () => {
    const { payout, run } = await setup();
    payout.named = 'Someone1111111111111111111111111111111111111';
    expect(await run()).toMatchObject({ enabled: false, refused: expect.stringMatching(/names Someone/) });
    payout.named = null;
    expect(await run()).toMatchObject({ enabled: false, refused: expect.stringMatching(/no payout key/) });
    expect(payout.prizes).toEqual([]);
  });

  it('pays the verified ranking (top 3 extra + the top-20 share), closes the pool, settles every signature into the mirror', async () => {
    const { ctx, payout, run, mirror } = await setup();
    await poolRide(ctx, 'bob', 500); await poolRide(ctx, 'bob', 500); await poolRide(ctx, 'alice', 900);
    await poolRide(ctx, 'mallory', 9_000, 'refused'); // an admin rejected it: decided, never paid
    const pass = await run();
    expect(pass).toMatchObject({ enabled: true, payout: KEY, chainNow: ctx.now().getTime() });
    expect(pass.pools).toEqual([{ poolId: 1, state: 'paid', note: null, closed: expect.any(String), paid: [
      { rank: 1, wallet: 'bob', lamports: 175_000_000, signature: expect.any(String) },
      { rank: 2, wallet: 'alice', lamports: 125_000_000, signature: expect.any(String) },
    ] }]);
    expect(payout.prizes.map((p) => [p.rank, p.to, p.lamports])).toEqual([[1, 'bob', 175_000_000], [2, 'alice', 125_000_000]]);
    expect(payout.closed).toEqual([1]);
    expect((await mirror()).status).toBe('settled'); // PrizePaid + PoolClosed applied to the mirror
    expect((await mirror()).payoutState).toBe('paid');
    expect((await ctx.poolPayouts.listByPool(1)).map((r) => [r.rank, r.status])).toEqual([[1, 'paid'], [2, 'paid']]);
    expect((await run()).pools).toEqual([]); // settled: nothing payable any more
  });

  it('waits while ANY completed ride of the pool is undecided (flagged, machine-rejected, unjudged) – then pays once an admin decided', async () => {
    const { ctx, payout, run, mirror } = await setup();
    await poolRide(ctx, 'alice', 900);
    const flagged = await poolRide(ctx, 'bob', 1_000, 'flagged');
    const rejected = await poolRide(ctx, 'carol', 800, 'rejected');
    const unjudged = await poolRide(ctx, 'dave', 850, 'none'); // similar distances: no pool-level mark, only the verdicts are under test
    expect((await run()).pools[0]).toMatchObject({ state: 'waiting_review', note: '3 ride(s) of this pool wait for an admin\'s decision', paid: [] });
    expect((await mirror()).payoutState).toBe('waiting_review');
    expect(payout.prizes).toEqual([]);
    await ctx.verdicts.override(flagged, VerdictStatus.Verified, 'Admin', null, null);
    await ctx.verdicts.override(rejected, VerdictStatus.Rejected, 'Admin', null, null);
    expect((await run()).pools[0]).toMatchObject({ state: 'waiting_review', note: '1 ride(s) of this pool wait for an admin\'s decision' });
    await ctx.verdicts.override(unjudged, VerdictStatus.Rejected, 'Admin', null, null); // judged first, then decided
    expect((await run()).pools[0]?.state).toBe('paid');
    expect(payout.prizes.map((p) => p.to)).toEqual(['bob', 'alice']);
  });

  it('an admin hold stops it; releasing the hold lets the next pass pay', async () => {
    const { ctx, payout, run, mirror } = await setup();
    await poolRide(ctx, 'alice', 900);
    const pool = await mirror();
    pool.putOnHold('Admin', 'check rank 1', ctx.now());
    await ctx.pools.saveHold(1, pool.hold);
    expect((await run()).pools[0]).toMatchObject({ state: 'held', note: 'check rank 1' });
    expect(payout.prizes).toEqual([]);
    await ctx.pools.saveHold(1, null);
    expect((await run()).pools[0]?.state).toBe('paid');
  });

  it('a sync never erases a hold (the server-owned columns change only through saveHold)', async () => {
    const { ctx, mirror } = await setup();
    const pool = await mirror();
    pool.putOnHold('Admin', null, ctx.now());
    await ctx.pools.saveHold(1, pool.hold);
    await ctx.registry.syncFromChain(1);
    expect((await mirror()).hold).toMatchObject({ by: 'Admin' });
  });

  it('no verified ride ranks → no_winners: nothing paid, nothing closed – the admin decides', async () => {
    const { ctx, payout, run } = await setup();
    await poolRide(ctx, 'alice', 900, 'refused');
    expect((await run()).pools[0]).toMatchObject({ state: 'no_winners', paid: [], closed: null });
    expect(payout.closed).toEqual([]);
  });

  it('before the review window ends (chain clock) the pool is not on the work list', async () => {
    const { ctx, payout, run } = await setup();
    await poolRide(ctx, 'alice', 900);
    payout.now = new Date(ctx.now().getTime() - 1);
    expect((await run()).pools).toEqual([]);
    expect(payout.prizes).toEqual([]);
  });

  it('a prize whose transaction was dropped goes back to planned and is paid ONCE by the next pass', async () => {
    const { ctx, payout, run } = await setup();
    await poolRide(ctx, 'alice', 900); await poolRide(ctx, 'bob', 500);
    payout.dropping.add(2);
    const first = await run();
    expect(first.pools[0]).toMatchObject({ state: 'paying', paid: [{ rank: 1, wallet: 'alice' }] });
    expect((await ctx.poolPayouts.listByPool(1)).map((r) => [r.rank, r.status, r.attempts])).toEqual([[1, 'paid', 1], [2, 'planned', 1]]);
    const second = await run();
    expect(second.pools[0]).toMatchObject({ state: 'paid', paid: [{ rank: 2, wallet: 'bob' }] });
    expect(payout.prizes.map((p) => p.rank)).toEqual([1, 2]); // rank 2 landed once
  });

  it('a crash after the claim: the `sent` row is resolved from its signature – landed = paid, nothing sent again', async () => {
    const { ctx, payout, run } = await setup();
    await poolRide(ctx, 'alice', 900);
    await run(); // plans + pays + closes
    // replay the crash on a fresh pool: plan by hand, claim, the transaction landed but the server died before markPaid
    const t = ctx.now().getTime();
    ctx.poolChain.pools.set(2, chainPool(ctx.now(), { poolId: 2, status: 'active', ticketsSold: 10, minTickets: 2, priceLamports: 50_000_000, prepDeadline: new Date(t - 4 * DAY), playDeadline: new Date(t - 3 * DAY), payoutAt: new Date(t) }));
    await ctx.registry.syncFromChain(2);
    await poolRide(ctx, 'bob', 700, 'verified', 2);
    await ctx.poolPayouts.plan([{ poolId: 2, rank: 1, wallet: 'bob', lamports: 300_000_000, status: 'planned' }], ctx.now());
    await ctx.poolPayouts.claimSent(2, 1, 'LandedSig', 250, ctx.now());
    ctx.poolChain.statuses.set('LandedSig', 'confirmed');
    ctx.poolChain.addTransaction([{ kind: 'PrizePaid', poolId: 2, to: 'bob', lamports: 300_000_000, rank: 1, prizesPaidTotal: 300_000_000 }], 'LandedSig');
    const before = payout.prizes.length;
    const pass = await run(2);
    expect(pass.pools[0]?.state).toBe('paid');
    expect(payout.prizes.length).toBe(before); // no second pay_prize
    expect((await ctx.poolPayouts.listByPool(2))[0]).toMatchObject({ status: 'paid', signature: 'LandedSig' });
  });

  it('a row claimed by another pass is never broadcast by this one', async () => {
    const { ctx, payout, run } = await setup();
    await poolRide(ctx, 'alice', 900);
    await ctx.poolPayouts.plan([{ poolId: 1, rank: 1, wallet: 'alice', lamports: 300_000_000, status: 'planned' }], ctx.now());
    await ctx.poolPayouts.claimSent(1, 1, 'InFlight', 250, ctx.now()); // the other pass's transaction, still unknown to the network
    ctx.poolChain.statuses.set('InFlight', 'processed');
    expect((await run()).pools[0]).toMatchObject({ state: 'paying', note: expect.stringMatching(/waiting for the prize of rank 1/) });
    expect(payout.prizes).toEqual([]);
  });

  it('a wallet the chain already shows paid (the admin paid by hand) is not paid again', async () => {
    const { ctx, payout, run } = await setup();
    await poolRide(ctx, 'alice', 900); await poolRide(ctx, 'bob', 500);
    await ctx.chainEvents.record({ signature: 'byhand', index: 0, kind: 'PrizePaid', poolId: 1, wallet: 'alice', orderId: null, lamports: 175_000_000, outcome: 'applied', detail: null, at: ctx.now(), finalizedAt: null, lastValidBlockHeight: null });
    await run();
    expect(payout.prizes.map((p) => p.to)).toEqual(['bob']);
    expect((await ctx.poolPayouts.listByPool(1)).find((r) => r.wallet === 'alice')?.status).toBe('paid');
  });

  it('a prize the chain refuses before anything is signed → error with the reason; the next pass retries it', async () => {
    const { ctx, payout, run } = await setup();
    await poolRide(ctx, 'alice', 900);
    payout.failing.add('1');
    expect((await run()).pools[0]).toMatchObject({ state: 'error', note: expect.stringMatching(/rank 1: .*scripted/) });
    expect((await ctx.poolPayouts.listByPool(1))[0]).toMatchObject({ status: 'planned', error: expect.stringMatching(/scripted/) });
    payout.failing.clear();
    expect((await run()).pools[0]?.state).toBe('paid');
  });

  it('the pool-level checks run before the plan: a distance outlier goes back under review and the pool waits for the admin', async () => {
    const { ctx, payout, run } = await setup();
    for (const w of ['alice', 'bob', 'carol']) await poolRide(ctx, w, 500);
    await poolRide(ctx, 'dave', 5_000); // 10 × the median of the four
    const pass = await run();
    expect(pass.pools[0]).toMatchObject({ state: 'waiting_review', note: '1 ride(s) of this pool wait for an admin\'s decision' });
    expect(payout.prizes).toEqual([]);
  });

  it('a wallet that signed up the day of the pool and ranks top 3 goes under review first', async () => {
    const { ctx, payout, run } = await setup();
    await ctx.player('newcomer');
    await poolRide(ctx, 'alice', 500); await poolRide(ctx, 'newcomer', 600);
    expect((await run()).pools[0]).toMatchObject({ state: 'waiting_review' });
    expect(payout.prizes).toEqual([]);
  });

  it('a crash after the claim, and the transaction landed but FAILED on chain: not counted as paid – back to planned, paid by a new transaction', async () => {
    const { ctx, payout, run } = await setup();
    await poolRide(ctx, 'alice', 900);
    await ctx.poolPayouts.plan([{ poolId: 1, rank: 1, wallet: 'alice', lamports: 300_000_000, status: 'planned' }], ctx.now());
    await ctx.poolPayouts.claimSent(1, 1, 'FailedSig', 250, ctx.now());
    ctx.poolChain.statuses.set('FailedSig', 'confirmed'); // a failed transaction is "confirmed" too
    ctx.poolChain.events.set('FailedSig', { invalid: 'the transaction failed: custom program error 0x1771' });
    const pass = await run();
    expect(pass.pools[0]?.state).toBe('paid');
    expect(payout.prizes.map((p) => [p.rank, p.to])).toEqual([[1, 'alice']]); // paid once, by a NEW transaction
    expect((await ctx.poolPayouts.listByPool(1))[0]).toMatchObject({ status: 'paid', attempts: 2 });
    expect((await ctx.poolPayouts.listByPool(1))[0]?.signature).not.toBe('FailedSig');
  });
});
