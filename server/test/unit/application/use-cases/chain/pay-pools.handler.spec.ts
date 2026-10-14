import { createHash } from 'node:crypto';
import { Keypair } from '@solana/web3.js';
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
import { unitContext, type UnitContext } from '../../../../support/unit-context.js';
import { VerdictStatus } from '../../../../../src/domain/verdict/verdict.dto.js';
import { RideVerdict } from '../../../../../src/domain/verdict/ride-verdict.entity.js';
import { Ride } from '../../../../../src/domain/rides/ride.entity.js';
import { Pledge } from '../../../../../src/domain/economy/pledge.entity.js';
import { SETTLE_GRACE_MS } from '../../../../../src/domain/economy/pool-crank.js';
import { rootFromProof, winnerLeaf, winnersTree } from '../../../../../src/domain/economy/winners-merkle.js';

const KEY = 'Payout11111111111111111111111111111111111111';
const DAY = 86_400_000;
const sha = (d: Uint8Array | Buffer) => createHash('sha256').update(d).digest();
/** riders as real addresses (a winners leaf carries the wallet's 32 bytes) */
const W = Object.fromEntries(['alice', 'bob', 'carol', 'dave', 'mallory', 'newcomer', 'zed'].map((n) => [n, Keypair.fromSeed(sha(Buffer.from(n))).publicKey.toBase58()])) as Record<'alice' | 'bob' | 'carol' | 'dave' | 'mallory' | 'newcomer' | 'zed', string>;

/** an admin's (or the machine's) verdict written after the ride was judged once */
const verdict = (ctx: UnitContext, rideId: string, status: VerdictStatus, by: string | null = null) => ctx.verdictRepo.save(RideVerdict.restore({
  rideId, status, reasons: status === VerdictStatus.Verified ? [] : [{ code: 'test', detail: 'test', severity: status === VerdictStatus.Rejected ? 'reject' : 'flag' }],
  scores: {} as never, rulesVersion: 4, judgedAt: ctx.now(), version: 2, ...(by ? { overriddenBy: by, overriddenAt: ctx.now(), note: null } : {}),
}));

/** an active pledge (its PledgeCreated mirrored) from zed to the driver of `rideId` in pool 1 – program v4 settles a pledge on ITS ride */
const pledgeOn = async (ctx: UnitContext, driver: string, rideId: string = ctx.entropy.uuid()) => {
  const p = Pledge.create({ id: ctx.entropy.uuid(), pdaAddress: `pda-${rideId}`, rideId, sponsor: W.zed, driver, poolId: 1, lamportsPerKm: 1_000n, targetKm: 10, now: ctx.now() });
  p.apply({ kind: 'PledgeCreated', signature: 'create', slot: 1, rideId, sponsor: W.zed, driver, pool: 'pool1', maxLamports: 10_000n, lamportsPerKm: 1_000n, targetKm: 10 }, ctx.now());
  await ctx.pledges.insert(p);
  return rideId;
};

describe('PayPoolsHandler – the payout job (program v4: commit the winners, pay from payFrom)', () => {
  /** pool 1 on chain: active, 10 tickets × 0.05 SOL (prize 70 % = 0.35 SOL), play deadline a day ago, `payoutAt` = now (a one-day review window); mirrored.
      The job runs NOW (chain clock): a commit now locks the prizes until now + the review window (payFrom = t + DAY). */
  const setup = async () => {
    const ctx = unitContext();
    // riders who signed up days before the pool (a brand-new wallet in the top 3 is a pool-level mark of its own – tested below)
    for (const w of [W.alice, W.bob, W.carol, W.dave, W.mallory]) await ctx.player(w);
    ctx.clock.advance(3 * 86_400);
    const payout = new FakePoolPayoutChain(ctx.poolChain);
    payout.payoutAddress = KEY;
    payout.now = ctx.now();
    const t = ctx.now().getTime();
    ctx.poolChain.pools.set(1, chainPool(ctx.now(), {
      poolId: 1, status: 'active', ticketsSold: 10, minTickets: 2, priceLamports: 50_000_000, vaultLamports: 890_880 + 500_000_000, escrowLamports: 500_000_000,
      prepDeadline: new Date(t - 2 * DAY), playDeadline: new Date(t - DAY), payoutAt: new Date(t),   // the riders signed up 3 days ago; their rides end by the play deadline (H6)
    }));
    await ctx.registry.syncFromChain(1);
    const settle = new SettleChainSignatureHandler(ctx.poolChain, ctx.chainEvents, ctx.ticketSettlement, ctx.registry, ctx.clock);
    const bus = { execute: async (c: object) => { if (!(c instanceof SettleChainSignatureCommand)) throw new Error('unexpected command'); return settle.execute(c); } };
    const attention = new PoolAttentionService(ctx.adminQuery, ctx.signIns, ctx.players, ctx.verdicts, ctx.batches);
    const attestation = new AttestationService(payout, ctx.rides, ctx.verdictRepo, ctx.batches, ctx.pools, ctx.hasher);
    const handler = new PayPoolsHandler(payout, ctx.poolChain, ctx.pools, ctx.poolPayouts, ctx.rideQuery, ctx.registry, attention, bus as unknown as CommandBus, ctx.clock, attestation, ctx.pledges, ctx.hasher);
    const run = (poolId: number | null = null) => handler.execute(new PayPoolsCommand(poolId));
    const mirror = async () => (await ctx.pools.findById(1))!;
    const onChain = (poolId = 1) => ctx.poolChain.pools.get(poolId)!;
    /** the chain clock to the committed pool's payFrom (the review lock is over) */
    const toPayFrom = (poolId = 1) => { payout.now = onChain(poolId).payFrom!; };
    /** a pass that commits, then a pass from payFrom (the second pass is returned) */
    const pay = async (poolId: number | null = null) => {
      await run(poolId);
      const p = onChain(poolId ?? 1);
      if (p.payFrom && p.payFrom.getTime() > payout.now.getTime()) payout.now = p.payFrom;
      return run(poolId);
    };
    return { ctx, payout, run, pay, mirror, onChain, toPayFrom, t };
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
    expect(payout.calls).toEqual([]);
  });

  it('commits the verified ranking, pays it from payFrom (top 3 extra + the top-20 share), closes the pool, settles every signature into the mirror', async () => {
    const { ctx, payout, run, mirror, onChain, toPayFrom } = await setup();
    await poolRide(ctx, W.bob, 5_000); await poolRide(ctx, W.bob, 5_000); await poolRide(ctx, W.alice, 9_000);
    await poolRide(ctx, W.mallory, 90_000, 'refused'); // an admin rejected it: decided, never paid
    expect((await run()).pools[0]).toMatchObject({ state: 'committed', paid: [], closed: null });
    toPayFrom();
    const pass = await run();
    expect(pass).toMatchObject({ enabled: true, payout: KEY, chainNow: payout.now.getTime() });
    expect(pass.pools).toEqual([{ poolId: 1, state: 'paid', note: null, closed: expect.any(String), paid: [
      { rank: 1, wallet: W.bob, lamports: 175_000_000, signature: expect.any(String) },
      { rank: 2, wallet: W.alice, lamports: 125_000_000, signature: expect.any(String) },
    ] }]);
    expect(payout.calls).toEqual(['commit 1 2', 'prize 1 1', 'prize 1 2', 'close 1']);
    expect(payout.prizes.map((p) => [p.rank, p.to, p.lamports])).toEqual([[1, W.bob, 175_000_000], [2, W.alice, 125_000_000]]);
    expect(onChain().paidMask).toBe(3n);
    expect((await mirror()).status).toBe('settled'); // PrizePaid + PoolClosed applied to the mirror
    expect((await mirror()).payoutState).toBe('paid');
    expect((await ctx.poolPayouts.listByPool(1)).map((r) => [r.rank, r.status])).toEqual([[1, 'paid'], [2, 'paid']]);
    expect((await run()).pools).toEqual([]); // settled: nothing payable any more
  });

  it('waits while ANY completed ride of the pool is undecided (flagged, machine-rejected, unjudged) – nothing committed – then commits and pays once an admin decided', async () => {
    const { ctx, payout, run, pay, mirror } = await setup();
    await poolRide(ctx, W.alice, 9_000);
    const flagged = await poolRide(ctx, W.bob, 10_000, 'flagged');
    const rejected = await poolRide(ctx, W.carol, 8_000, 'rejected');
    const unjudged = await poolRide(ctx, W.dave, 8_500, 'none'); // similar distances: no pool-level mark, only the verdicts are under test
    expect((await run()).pools[0]).toMatchObject({ state: 'waiting_review', note: '3 ride(s) of this pool wait for an admin\'s decision', paid: [] });
    expect((await mirror()).payoutState).toBe('waiting_review');
    expect(payout.calls).toEqual([]);
    await ctx.verdicts.override(flagged, VerdictStatus.Verified, 'Admin', null, null);
    await ctx.verdicts.override(rejected, VerdictStatus.Rejected, 'Admin', null, null);
    expect((await run()).pools[0]).toMatchObject({ state: 'waiting_review', note: '1 ride(s) of this pool wait for an admin\'s decision' });
    await ctx.verdicts.override(unjudged, VerdictStatus.Rejected, 'Admin', null, null); // judged first, then decided
    expect((await pay()).pools[0]?.state).toBe('paid');
    expect(payout.prizes.map((p) => p.to)).toEqual([W.bob, W.alice]);
  });

  it('an admin hold stops it before the commit; releasing the hold lets the next passes commit and pay', async () => {
    const { ctx, payout, run, pay, mirror } = await setup();
    await poolRide(ctx, W.alice, 9_000);
    const pool = await mirror();
    pool.putOnHold('Admin', 'check rank 1', ctx.now());
    await ctx.pools.saveHold(1, pool.hold);
    expect((await run()).pools[0]).toMatchObject({ state: 'held', note: 'check rank 1' });
    expect(payout.calls).toEqual([]);
    await ctx.pools.saveHold(1, null);
    expect((await pay()).pools[0]?.state).toBe('paid');
  });

  describe('the commit (program v4 – pentest H5-B)', () => {
    it('is made at the play deadline and nothing is paid before payFrom (`committed`, the payFrom in the note); from payFrom the prizes go out', async () => {
      const { ctx, payout, run, mirror, onChain, t } = await setup();
      await poolRide(ctx, W.alice, 9_000); await poolRide(ctx, W.bob, 5_000);
      payout.now = new Date(t - DAY);   // the chain clock AT the play deadline: payFrom = max(payoutAt, now + review window) = t
      const pass = (await run()).pools[0];
      expect(pass).toMatchObject({ state: 'committed', note: expect.stringContaining(new Date(t).toISOString()), paid: [], closed: null });
      expect((await mirror()).payoutState).toBe('committed');
      expect(payout.calls).toEqual(['commit 1 2']);
      const rows = await ctx.poolPayouts.listByPool(1);
      expect(rows.map((r) => [r.rank, r.wallet, r.status])).toEqual([[1, W.alice, 'planned'], [2, W.bob, 'planned']]);
      const tree = winnersTree(1, rows.map((r) => ({ wallet: r.wallet, lamports: r.lamports })), sha);
      expect(onChain()).toMatchObject({ winnersRoot: tree.root.toString('base64'), winnersCount: 2, winnersTotal: tree.total, payFrom: new Date(t) });
      payout.now = new Date(t - 1);   // one ms before payFrom: still locked, no second commit
      expect((await run()).pools[0]).toMatchObject({ state: 'committed', paid: [] });
      expect(payout.calls).toEqual(['commit 1 2']);
      payout.now = new Date(t);
      expect((await run()).pools[0]).toMatchObject({ state: 'paid', paid: [{ rank: 1, wallet: W.alice }, { rank: 2, wallet: W.bob }] });
    });

    it('pays every rank with a proof that leads to the committed root (an odd leaf promoted)', async () => {
      const { ctx, payout, pay, onChain } = await setup();
      await poolRide(ctx, W.alice, 9_000); await poolRide(ctx, W.bob, 8_000); await poolRide(ctx, W.carol, 7_000);
      const sent: { rank: number; to: string; lamports: number; proof: Uint8Array[] }[] = [];
      const payPrize = payout.payPrize.bind(payout);
      payout.payPrize = async (i, onSigned) => { sent.push(i); return payPrize(i, onSigned); };
      expect((await pay()).pools[0]?.state).toBe('paid');
      expect(sent.map((s) => [s.rank, s.to])).toEqual([[1, W.alice], [2, W.bob], [3, W.carol]]);
      for (const s of sent) {
        const root = rootFromProof(winnerLeaf(1, s.rank - 1, { wallet: s.to, lamports: s.lamports }, sha), s.rank - 1, 3, s.proof, sha);
        expect(root?.toString('base64')).toBe(onChain().winnersRoot);
      }
      expect(onChain().paidMask).toBe(7n);
    });

    it('a ranking that drifts after the commit stops the pool for the admin\'s veto; with the root vetoed and nothing paid the plan is discarded and the new ranking committed', async () => {
      const { ctx, payout, run, onChain, toPayFrom } = await setup();
      await poolRide(ctx, W.alice, 9_000);
      const bob = await poolRide(ctx, W.bob, 5_000);
      expect((await run()).pools[0]?.state).toBe('committed');
      await verdict(ctx, bob, VerdictStatus.Rejected, 'Admin');   // decided after the commit: bob no longer ranks
      expect((await run()).pools[0]).toMatchObject({ state: 'error', note: expect.stringMatching(/ranking changed after the payout plan.*vetoes the committed winners/) });
      toPayFrom();
      expect((await run()).pools[0]).toMatchObject({ state: 'error' });   // not even from payFrom: the committed root is not paid while the ranking moved
      expect(payout.prizes).toEqual([]);
      expect((await ctx.poolPayouts.listByPool(1)).map((r) => r.wallet)).toEqual([W.alice, W.bob]);   // the plan kept until the veto
      ctx.poolChain.pools.set(1, { ...onChain(), winnersRoot: null, winnersTotal: 0, winnersCount: 0, committedAt: null, payFrom: null, paidMask: 0n });   // the admin's veto_winners
      expect((await run()).pools[0]?.state).toBe('committed');   // a new commit: a new review lock
      expect(payout.calls).toEqual(['commit 1 2', 'commit 1 1']);
      expect((await ctx.poolPayouts.listByPool(1)).map((r) => [r.rank, r.wallet, r.status])).toEqual([[1, W.alice, 'planned']]);
      toPayFrom();
      expect((await run()).pools[0]?.state).toBe('paid');
      expect(payout.prizes.map((p) => p.to)).toEqual([W.alice]);
    });

    it('a commit the chain refuses → error with the reason, nothing paid; the next pass commits', async () => {
      const { ctx, payout, run } = await setup();
      await poolRide(ctx, W.alice, 9_000);
      payout.failing.add('commit');
      expect((await run()).pools[0]).toMatchObject({ state: 'error', note: expect.stringMatching(/commit_winners: .*scripted/) });
      expect(payout.calls).toEqual([]);
      payout.failing.clear();
      expect((await run()).pools[0]?.state).toBe('committed');
      expect(payout.calls).toEqual(['commit 1 1']);
    });

    it('WinnersCommitted from the chain (another pass came first) = already committed: the root is read again and compared', async () => {
      const { ctx, payout, run, toPayFrom } = await setup();
      await poolRide(ctx, W.alice, 9_000);
      const commit = payout.commitWinners.bind(payout);
      payout.commitWinners = async (i) => { await commit(i); return commit(i); };   // the other pass's commit lands first, ours is refused
      expect((await run()).pools[0]?.state).toBe('committed');
      expect(payout.calls).toEqual(['commit 1 1']);
      toPayFrom();
      expect((await run()).pools[0]?.state).toBe('paid');
    });

    it('a committed root that is not this plan → error, nothing paid', async () => {
      const { ctx, payout, run, onChain, toPayFrom } = await setup();
      await poolRide(ctx, W.alice, 9_000);
      await run();
      ctx.poolChain.pools.set(1, { ...onChain(), winnersRoot: Buffer.alloc(32, 7).toString('base64') });
      toPayFrom();
      expect((await run()).pools[0]).toMatchObject({ state: 'error', note: expect.stringMatching(/not this plan/) });
      expect(payout.prizes).toEqual([]);
    });

    it('too close to the settle grace the commit is not sent: error for the admin', async () => {
      const { ctx, payout, run } = await setup();
      await poolRide(ctx, W.alice, 9_000);
      ctx.clock.advance(SETTLE_GRACE_MS / 1000);   // its lock would end past payoutAt + grace − COMMIT_GRACE_MARGIN – by the CHAIN clock, like the program
      payout.now = ctx.now();
      expect((await run()).pools[0]).toMatchObject({ state: 'error', note: expect.stringMatching(/too late to commit/) });
      expect(payout.calls).toEqual([]);
    });
  });

  describe('a verdict decided AFTER the plan (pentest M7)', () => {
    it('a ride put under review after the commit stops the money (waiting_review, plan kept); rejected by the admin it changes the ranking – error, nothing more is paid, even with the root vetoed (partly paid)', async () => {
      const { ctx, payout, run, onChain, toPayFrom } = await setup();
      await poolRide(ctx, W.alice, 9_000);
      const bob = await poolRide(ctx, W.bob, 5_000);
      await run();
      toPayFrom();
      payout.failing.add('2');
      expect((await run()).pools[0]).toMatchObject({ state: 'error' });   // alice paid, bob's prize refused once
      expect(payout.prizes.map((p) => p.to)).toEqual([W.alice]);
      payout.failing.clear();
      await verdict(ctx, bob, VerdictStatus.Flagged);
      expect((await run()).pools[0]).toMatchObject({ state: 'waiting_review' });
      await verdict(ctx, bob, VerdictStatus.Rejected, 'Admin');
      expect((await run()).pools[0]).toMatchObject({ state: 'error', note: expect.stringMatching(/ranking changed after the payout plan.*vetoes/) });
      ctx.poolChain.pools.set(1, { ...onChain(), winnersRoot: null });
      expect((await run()).pools[0]).toMatchObject({ state: 'error', note: expect.stringMatching(/ranking changed after the payout plan/) });   // a partly paid plan is never re-planned
      expect(payout.prizes.map((p) => p.to)).toEqual([W.alice]);
      expect(payout.closed).toEqual([]);
    });

    it('a pledged ride revoked after the commit (the ranking unchanged) is attested again before the close – its sponsors settle on the new verdict', async () => {
      const { ctx, payout, run, toPayFrom } = await setup();
      await poolRide(ctx, W.alice, 9_000);
      const bob5 = await pledgeOn(ctx, W.bob, await poolRide(ctx, W.bob, 5_000));
      await poolRide(ctx, W.bob, 2_000, 'accepted');   // bob's other verified ride
      await run();
      expect(payout.calls).toEqual([`attest 1 ${bob5} 1`, 'commit 1 2']);
      expect(payout.attestations.get(`1:${bob5}`)).toMatchObject({ status: 1, verifiedKm: 5 });
      await verdict(ctx, bob5, VerdictStatus.Rejected, 'Admin');   // bob still ranks 2nd on his other ride: no drift
      toPayFrom();
      expect((await run()).pools[0]).toMatchObject({ state: 'paid' });
      expect(payout.calls.slice(2)).toEqual(['prize 1 1', 'prize 1 2', `attest 1 ${bob5} 2`, 'close 1']);
      expect(payout.attestations.get(`1:${bob5}`)).toMatchObject({ status: 2, verifiedKm: 0 });
    });
  });

  it('an admin HOLD acknowledged while a pass is paying stops the prizes after it and the close (the claim and the HOLD serialise on the pool row – L11)', async () => {
    const { ctx, payout, run, mirror, toPayFrom } = await setup();
    await poolRide(ctx, W.alice, 9_000); await poolRide(ctx, W.bob, 5_000); await poolRide(ctx, W.carol, 3_000);
    await run();
    toPayFrom();
    const pay = payout.payPrize.bind(payout);
    payout.payPrize = async (i, onSigned) => {
      const r = await pay(i, onSigned);
      if (i.rank === 1) { const p = await mirror(); p.putOnHold('Admin', 'stop after rank 1', ctx.now()); await ctx.pools.saveHold(1, p.hold); }
      return r;
    };
    expect((await run()).pools[0]).toMatchObject({ state: 'held', note: expect.stringMatching(/held before rank 2/) });
    expect(payout.prizes.map((p) => p.to)).toEqual([W.alice]);
    expect(payout.closed).toEqual([]);
    expect((await ctx.poolPayouts.listByPool(1)).filter((r) => r.status === 'sent')).toEqual([]);   // no prize claimed after the HOLD
    expect((await run()).pools[0]).toMatchObject({ state: 'held', note: 'stop after rank 1' });
  });

  it('a HOLD before the close stops the close and the attestations after the last prize', async () => {
    const { ctx, payout, run, mirror, toPayFrom } = await setup();
    await poolRide(ctx, W.alice, 9_000);
    await run();
    toPayFrom();
    const pay = payout.payPrize.bind(payout);
    payout.payPrize = async (i, onSigned) => { const r = await pay(i, onSigned); const p = await mirror(); p.putOnHold('Admin', 'stop the close', ctx.now()); await ctx.pools.saveHold(1, p.hold); return r; };
    expect((await run()).pools[0]).toMatchObject({ state: 'held', note: 'stop the close', paid: [{ rank: 1 }], closed: null });
    expect(payout.closed).toEqual([]);
  });

  it('a sync never erases a hold (the server-owned columns change only through saveHold)', async () => {
    const { ctx, mirror } = await setup();
    const pool = await mirror();
    pool.putOnHold('Admin', null, ctx.now());
    await ctx.pools.saveHold(1, pool.hold);
    await ctx.registry.syncFromChain(1);
    expect((await mirror()).hold).toMatchObject({ by: 'Admin' });
  });

  it('no verified ride ranks → no_winners: nothing committed, paid or closed – the admin decides', async () => {
    const { ctx, payout, run } = await setup();
    await poolRide(ctx, W.alice, 9_000, 'refused');
    expect((await run()).pools[0]).toMatchObject({ state: 'no_winners', paid: [], closed: null });
    expect(payout.calls).toEqual([]);
    expect(payout.closed).toEqual([]);
  });

  it('before the play deadline (chain clock) the pool is not on the work list', async () => {
    const { ctx, payout, run, t } = await setup();
    await poolRide(ctx, W.alice, 9_000);
    payout.now = new Date(t - DAY - 1);
    expect((await run()).pools).toEqual([]);
    expect(payout.calls).toEqual([]);
  });

  it('a prize whose transaction was dropped goes back to planned and is paid ONCE by the next pass', async () => {
    const { ctx, payout, run, toPayFrom } = await setup();
    await poolRide(ctx, W.alice, 9_000); await poolRide(ctx, W.bob, 5_000);
    await run();
    toPayFrom();
    payout.dropping.add(2);
    expect((await run()).pools[0]).toMatchObject({ state: 'paying', paid: [{ rank: 1, wallet: W.alice }] });
    expect((await ctx.poolPayouts.listByPool(1)).map((r) => [r.rank, r.status, r.attempts])).toEqual([[1, 'paid', 1], [2, 'planned', 1]]);
    expect((await run()).pools[0]).toMatchObject({ state: 'paid', paid: [{ rank: 2, wallet: W.bob }] });
    expect(payout.prizes.map((p) => p.rank)).toEqual([1, 2]); // rank 2 landed once
  });

  /** the pass that crashed: rank 1 claimed, its transaction landed (PrizePaid on chain, the rank's paidMask bit set), the server died before markPaid */
  const crashedAfterLanding = async () => {
    const s = await setup();
    await poolRide(s.ctx, W.bob, 7_000);
    await s.run();   // planned + committed
    const row = (await s.ctx.poolPayouts.listByPool(1))[0]!;
    await s.ctx.poolPayouts.claimSent(1, 1, 'LandedSig', 250, s.ctx.now());
    s.ctx.poolChain.statuses.set('LandedSig', 'confirmed');
    s.ctx.poolChain.addTransaction([{ kind: 'PrizePaid', poolId: 1, to: W.bob, lamports: row.lamports, rank: 0, prizesPaidTotal: row.lamports }], 'LandedSig');
    s.ctx.poolChain.pools.set(1, { ...s.onChain(), prizesPaid: row.lamports, paidMask: 1n });
    s.toPayFrom();
    return s;
  };

  it('a crash after the claim, the transaction landed: nothing sent again, the pool closes', async () => {
    const { payout, run } = await crashedAfterLanding();
    expect((await run()).pools[0]?.state).toBe('paid');
    expect(payout.prizes).toEqual([]); // no second pay_prize
  });

  // regression: the paidMask short-cut once ran before payRow – a `sent` row whose own transaction landed (bit set) stayed `sent`, its signature never settled
  it('a crash after the claim, the transaction landed: the `sent` row is resolved from its signature – paid with LandedSig', async () => {
    const { ctx, run } = await crashedAfterLanding();
    await run();
    expect((await ctx.poolPayouts.listByPool(1))[0]).toMatchObject({ status: 'paid', signature: 'LandedSig' });
  });

  it('a row claimed by another pass is never broadcast by this one', async () => {
    const { ctx, payout, run, toPayFrom } = await setup();
    await poolRide(ctx, W.alice, 9_000);
    await run();
    await ctx.poolPayouts.claimSent(1, 1, 'InFlight', 250, ctx.now()); // the other pass's transaction, still unknown to the network
    ctx.poolChain.statuses.set('InFlight', 'processed');
    toPayFrom();
    expect((await run()).pools[0]).toMatchObject({ state: 'paying', note: expect.stringMatching(/waiting for the prize of rank 1/) });
    expect(payout.prizes).toEqual([]);
  });

  it('a rank the chain already shows paid (paidMask – anyone may pay a committed rank) is marked paid elsewhere, never paid twice', async () => {
    const { ctx, payout, run, onChain, toPayFrom } = await setup();
    await poolRide(ctx, W.alice, 9_000); await poolRide(ctx, W.bob, 5_000);
    await run();
    ctx.poolChain.pools.set(1, { ...onChain(), paidMask: 1n });   // rank 1 paid by someone else's pay_prize
    toPayFrom();
    expect((await run()).pools[0]).toMatchObject({ state: 'paid', paid: [{ rank: 2, wallet: W.bob }] });
    expect(payout.prizes.map((p) => p.to)).toEqual([W.bob]);
    expect((await ctx.poolPayouts.listByPool(1))[0]).toMatchObject({ wallet: W.alice, status: 'paid', error: 'paid outside the payout job' });
    expect(payout.closed).toEqual([1]);
  });

  it('a prize the chain refuses before anything is signed → error with the reason; the next pass retries it', async () => {
    const { ctx, payout, run, toPayFrom } = await setup();
    await poolRide(ctx, W.alice, 9_000);
    await run();
    toPayFrom();
    payout.failing.add('1');
    expect((await run()).pools[0]).toMatchObject({ state: 'error', note: expect.stringMatching(/rank 1: .*scripted/) });
    expect((await ctx.poolPayouts.listByPool(1))[0]).toMatchObject({ status: 'planned', error: expect.stringMatching(/scripted/) });
    payout.failing.clear();
    expect((await run()).pools[0]?.state).toBe('paid');
  });

  it('the pool-level checks run before the plan: a distance outlier goes back under review and the pool waits for the admin', async () => {
    const { ctx, payout, run } = await setup();
    for (const w of [W.alice, W.bob, W.carol]) await poolRide(ctx, w, 5_000);
    await poolRide(ctx, W.dave, 50_000); // 10 × the median of the four
    expect((await run()).pools[0]).toMatchObject({ state: 'waiting_review', note: '1 ride(s) of this pool wait for an admin\'s decision' });
    expect(payout.calls).toEqual([]);
  });

  it('a wallet that signed up the day of the pool and ranks top 3 goes under review first', async () => {
    const { ctx, payout, run } = await setup();
    await ctx.player(W.newcomer);
    await poolRide(ctx, W.alice, 5_000); await poolRide(ctx, W.newcomer, 6_000);
    expect((await run()).pools[0]).toMatchObject({ state: 'waiting_review' });
    expect(payout.calls).toEqual([]);
  });

  it('a crash after the claim, and the transaction landed but FAILED on chain: not counted as paid – back to planned, paid by a new transaction', async () => {
    const { ctx, payout, run, toPayFrom } = await setup();
    await poolRide(ctx, W.alice, 9_000);
    await run();
    await ctx.poolPayouts.claimSent(1, 1, 'FailedSig', 250, ctx.now());
    ctx.poolChain.statuses.set('FailedSig', 'confirmed'); // a failed transaction is "confirmed" too
    ctx.poolChain.events.set('FailedSig', { invalid: 'the transaction failed: custom program error 0x1771' });
    toPayFrom();
    expect((await run()).pools[0]?.state).toBe('paid');
    expect(payout.prizes.map((p) => [p.rank, p.to])).toEqual([[1, W.alice]]); // paid once, by a NEW transaction
    expect((await ctx.poolPayouts.listByPool(1))[0]).toMatchObject({ status: 'paid', attempts: 2 });
    expect((await ctx.poolPayouts.listByPool(1))[0]?.signature).not.toBe('FailedSig');
  });

  it('a crash after the claim, and the transaction expired without landing: back to planned, paid by a new transaction', async () => {
    const { ctx, payout, run, toPayFrom } = await setup();
    await poolRide(ctx, W.alice, 9_000);
    await run();
    await ctx.poolPayouts.claimSent(1, 1, 'ExpiredSig', 250, ctx.now());
    ctx.poolChain.statuses.set('ExpiredSig', 'expired');
    toPayFrom();
    expect((await run()).pools[0]?.state).toBe('paid');
    expect(payout.prizes.map((p) => [p.rank, p.to])).toEqual([[1, W.alice]]);
    expect((await ctx.poolPayouts.listByPool(1))[0]?.signature).not.toBe('ExpiredSig');
  });

  describe('pledged rides', () => {
    it('every pledged ride is attested BEFORE the commit (and checked again before close_pool): verified km, flagged when rejected, nothing for a ride that never finished', async () => {
      const { ctx, payout, run, toPayFrom } = await setup();
      const alice = await pledgeOn(ctx, W.alice, await poolRide(ctx, W.alice, 9_000));
      const dave = await pledgeOn(ctx, W.dave, await poolRide(ctx, W.dave, 8_500, 'refused'));
      await pledgeOn(ctx, W.carol); await pledgeOn(ctx, W.carol);   // rides carol never drove
      expect((await run()).pools[0]?.state).toBe('committed');
      expect(payout.calls).toEqual([`attest 1 ${alice} 1`, `attest 1 ${dave} 2`, 'commit 1 1']);
      toPayFrom();
      expect((await run()).pools[0]).toMatchObject({ state: 'paid' });
      expect(payout.calls.slice(3)).toEqual(['prize 1 1', 'close 1']);   // the chain already says what the verdicts say: nothing re-sent
      expect(payout.attestations.get(`1:${alice}`)).toMatchObject({ status: 1, verifiedKm: 9 });
      expect(payout.attestations.get(`1:${dave}`)).toMatchObject({ status: 2, verifiedKm: 0 });
      expect([...payout.attestations.keys()]).toEqual([`1:${alice}`, `1:${dave}`]);
    });

    it('a pledged ride not decided yet (still on the road) holds the commit: waiting_review', async () => {
      const { ctx, payout, run } = await setup();
      await poolRide(ctx, W.alice, 9_000);
      const r = Ride.createFromTicket({ id: ctx.entropy.uuid(), wallet: W.carol, tier: '1h', seed: 1, minSeconds: 3600, timeScale: 1, poolId: 1, roundId: 1, now: ctx.now() });
      await ctx.rides.insert(r);
      await pledgeOn(ctx, W.carol, r.id);
      expect((await run()).pools[0]).toMatchObject({ state: 'waiting_review', note: expect.stringMatching(new RegExp(`pledged ride ${r.id} is not decided yet`)) });
      expect(payout.calls).toEqual([]);
    });

    it('a failed attestation does NOT close the pool (after the close no attestation is possible); the next pass finishes', async () => {
      const { ctx, payout, run, mirror, toPayFrom } = await setup();
      await poolRide(ctx, W.alice, 9_000);
      const bob5 = await pledgeOn(ctx, W.bob, await poolRide(ctx, W.bob, 5_000));
      await poolRide(ctx, W.bob, 2_000, 'accepted');
      await run();
      await verdict(ctx, bob5, VerdictStatus.Rejected, 'Admin');   // its attestation must be written again before the close
      payout.failingAttestations.add(bob5);
      toPayFrom();
      expect((await run()).pools[0]).toMatchObject({ state: 'error', note: expect.stringMatching(new RegExp(`attestation of pledged ride ${bob5} failed`)), closed: null });   // an outage, not a review
      expect(payout.prizes.map((p) => p.to)).toEqual([W.alice, W.bob]);
      expect(payout.closed).toEqual([]);
      expect((await mirror()).status).toBe('active');
      payout.failingAttestations.clear();
      expect((await run()).pools[0]).toMatchObject({ state: 'paid' });
      expect(payout.calls.slice(-2)).toEqual([`attest 1 ${bob5} 2`, 'close 1']);
    });

    it('a failed attestation before the commit holds the commit too', async () => {
      const { ctx, payout, run } = await setup();
      const alice = await pledgeOn(ctx, W.alice, await poolRide(ctx, W.alice, 9_000));
      payout.failingAttestations.add(alice);
      expect((await run()).pools[0]).toMatchObject({ state: 'error', note: expect.stringMatching(/attestation of pledged ride .* failed/) });
      expect(payout.calls).toEqual([]);
      payout.failingAttestations.clear();
      expect((await run()).pools[0]?.state).toBe('committed');
      expect(payout.calls).toEqual([`attest 1 ${alice} 1`, 'commit 1 1']);
    });

    it('a pool with no winners still attests its pledged rides (their sponsors are refunded by settle)', async () => {
      const { ctx, payout, run } = await setup();
      const alice = await pledgeOn(ctx, W.alice, await poolRide(ctx, W.alice, 9_000, 'refused'));
      expect((await run()).pools[0]).toMatchObject({ state: 'no_winners', closed: null });
      expect(payout.calls).toEqual([`attest 1 ${alice} 2`]);
      expect((await run()).pools[0]).toMatchObject({ state: 'no_winners' }); // decided on chain already: nothing sent again
      expect(payout.calls).toHaveLength(1);
    });
  });
});
