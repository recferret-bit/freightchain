import { describe, expect, it } from 'vitest';
import { SyncPledgesHandler } from '../../../../../src/application/use-cases/pledges/sync-pledges/sync-pledges.handler.js';
import { ATTESTATION_FLAGGED, ATTESTATION_VERIFIED } from '../../../../../src/application/ports/economy/pool-payout-chain.port.js';
import { SETTLE_GRACE_MS } from '../../../../../src/domain/economy/pool-crank.js';
import type { PoolProps } from '../../../../../src/domain/economy/pool.types.js';
import { FakePoolPayoutChain } from '../../../../support/fake-pool-payout-chain.js';
import { aPool } from '../../../../support/pools.js';
import { aPledge, wallet } from '../../../../support/pledges.js';
import { unitContext } from '../../../../support/unit-context.js';
import { AttestationService } from '../../../../../src/application/services/attestation.service.js';
import { poolRide } from '../../../../support/pool-rides.js';
import { VerdictStatus } from '../../../../../src/domain/verdict/verdict.dto.js';

const KEY = 'Payout11111111111111111111111111111111111111';

describe('SyncPledgesHandler – the pledge job', () => {
  const setup = async (pool: Partial<PoolProps> = { status: 'active' }) => {
    const ctx = unitContext();
    const sponsor = wallet(), driver = wallet();
    await ctx.player(sponsor); await ctx.player(driver);
    await ctx.pools.upsert(aPool({ id: 1, ...pool }, ctx.now()));
    const payout = new FakePoolPayoutChain(ctx.poolChain);
    payout.payoutAddress = KEY;
    const handler = new SyncPledgesHandler(ctx.pledges, ctx.poolChain, payout, ctx.pools, ctx.players, ctx.transactions, ctx.clock, new AttestationService(payout, ctx.rides, ctx.batches, ctx.hasher));
    const row = async (id: string) => (await ctx.pledges.findById(id))!;
    /** an active pledge: on chain and mirrored */
    const active = async (o: { sponsor?: string; lamportsPerKm?: bigint; targetKm?: number } = {}) => {
      const { pledge } = await aPledge(ctx, { sponsor: o.sponsor ?? sponsor, driver, onChain: true, lamportsPerKm: o.lamportsPerKm, targetKm: o.targetKm });
      await handler.execute();
      expect((await row(pledge.id)).status).toBe('active');
      return pledge;
    };
    /** what the payout job wrote on chain – and the ride it rests on (the pledge job reads the rides again before it settles: pentest M7) */
    const attest = async (status: number, verifiedKm: number) => {
      payout.attestations.set(`1:${driver}`, { telemetryRoot: new Uint8Array(32), verifiedKm, status });
      await poolRide(ctx, driver, Math.max(1, verifiedKm) * 1000 + 300, status === ATTESTATION_VERIFIED ? 'verified' : 'refused');
    };
    return { ctx, sponsor, driver, payout, run: () => handler.execute(), row, active, attest };
  };

  it('a pending pledge whose create_pledge landed (nobody confirmed) turns active from its account\'s history', async () => {
    const { ctx, sponsor, driver, run, row, payout } = await setup();
    const { pledge, createSig } = await aPledge(ctx, { sponsor, driver, onChain: true });
    expect(await run()).toMatchObject({ sending: true, checked: 1, activated: 1, errors: [] });
    expect(await row(pledge.id)).toMatchObject({ props: expect.objectContaining({ status: 'active', createSignature: createSig }) });
    expect(payout.calls).toEqual([]); // the pool still runs: nothing to end
  });

  it('a pending pledge never signed: kept for an hour, then abandoned', async () => {
    const { ctx, sponsor, driver, run, row } = await setup();
    const { pledge } = await aPledge(ctx, { sponsor, driver });
    ctx.clock.advance(59 * 60);
    await run();
    expect((await row(pledge.id)).status).toBe('pending');
    ctx.clock.advance(2 * 60);
    expect(await run()).toMatchObject({ abandoned: 1 });
    expect((await row(pledge.id)).status).toBe('abandoned');
    expect((await run()).checked).toBe(0); // no longer open
  });

  it('a VERIFIED driver: settle_pledge pays max × min(km, target) / target and the row records the program\'s numbers', async () => {
    const { sponsor, run, row, active, attest, payout } = await setup();
    const p = await active({ lamportsPerKm: 3n, targetKm: 7 });
    await attest(ATTESTATION_VERIFIED, 2);
    expect(await run()).toMatchObject({ settled: 1 });
    expect(payout.calls).toEqual([`settle ${p.rideId} ${sponsor}`]);
    expect(await row(p.id)).toMatchObject({ status: 'settled', isSettled: true, earnedLamports: 6n, refundedLamports: 15n });
    expect((await run()).checked).toBe(0);
  });

  it('a FLAGGED driver: settled with nothing earned, the whole cap back to the sponsor', async () => {
    const { run, row, active, attest } = await setup();
    const p = await active();
    await attest(ATTESTATION_FLAGGED, 0);
    await run();
    expect(await row(p.id)).toMatchObject({ status: 'settled', earnedLamports: 0n, refundedLamports: p.maxLamports });
  });

  for (const [name, pool, advance] of [
    ['failed (refunding)', { status: 'refunding' }, 0],
    ['cancelled', { status: 'cancelled' }, 0],
    ['closed (settled)', { status: 'settled' }, 0],
    ['active past its settle grace', { status: 'active' }, 14 * 86_400 + 1],
  ] as [string, Partial<PoolProps>, number][]) {
    it(`a pool that is over – ${name} – and no attestation: refund_pledge gives everything back`, async () => {
      const { ctx, run, row, active, payout } = await setup();
      const p = await active();
      await ctx.pools.upsert(aPool({ id: 1, ...pool }, ctx.now()));
      const payoutAt = (await ctx.pools.findById(1))!.payoutAt.getTime();
      if (advance) ctx.clock.advance((payoutAt + SETTLE_GRACE_MS - ctx.now().getTime()) / 1000 + 1);
      expect(await run()).toMatchObject({ refunded: 1 });
      expect(payout.calls).toEqual([`refund ${p.rideId} ${p.sponsor}`]);
      expect(await row(p.id)).toMatchObject({ status: 'refunded', earnedLamports: 0n, refundedLamports: p.maxLamports });
    });
  }

  it('money the admin has not released waits: a held pool, one with rides under review, one stopped in error – nothing is settled (WP2 review)', async () => {
    for (const pool of [{ status: 'active' as const, hold: { by: 'Admin', at: new Date(0), note: 'wait' } }, { status: 'active' as const, payoutState: 'waiting_review' as const }, { status: 'active' as const, payoutState: 'error' as const }]) {
      const { run, row, active, attest, payout } = await setup(pool);
      const p = await active();
      await attest(ATTESTATION_VERIFIED, 2);
      await run();
      expect(payout.calls).toEqual([]);
      expect((await row(p.id)).status).toBe('active');
    }
  });

  it('a VERIFIED attestation whose ride was revoked since is written again (FLAGGED) before the pledge settles – the sponsor gets it all back (pentest M7)', async () => {
    const { ctx, driver, run, row, active, attest, payout } = await setup({ status: 'active' });
    const p = await active({ lamportsPerKm: 3n, targetKm: 7 });
    await attest(ATTESTATION_VERIFIED, 2);
    const ride = [...ctx.db.rides.values()].find((r) => r.props.wallet === driver)!.props.id;
    const v = (await ctx.verdictRepo.findByRide(ride))!;
    v.override(VerdictStatus.Rejected, 'Admin', null, ctx.now());
    await ctx.verdictRepo.save(v);
    await run();
    expect(payout.calls[0]).toMatch(new RegExp(`^attest 1 ${driver} 2`));   // FLAGGED first
    expect(await row(p.id)).toMatchObject({ status: 'settled', earnedLamports: 0n });
  });

  it('the pool still running (also: active before its grace, an UNVERIFIED attestation): nothing is sent', async () => {
    const { run, row, active, attest, payout } = await setup({ status: 'active' });
    const p = await active();
    await attest(0, 0);
    await run();
    expect(payout.calls).toEqual([]);
    expect((await row(p.id)).status).toBe('active');
  });

  it('without the payout key it only follows the chain – a refund the sponsor sent itself is still mirrored', async () => {
    const { ctx, sponsor, driver, run, row, active, attest, payout } = await setup({ status: 'settled' });
    payout.payoutAddress = null;
    const p = await active();
    await attest(ATTESTATION_VERIFIED, 5);
    expect(await run()).toMatchObject({ sending: false, settled: 0 });
    expect(payout.calls).toEqual([]);
    expect((await row(p.id)).status).toBe('active');
    ctx.poolChain.addPledgeTransaction([{ kind: 'PledgeRefunded', rideId: p.rideId, sponsor, driver, pool: 'pool1', refundedLamports: p.maxLamports }]);
    await run();
    expect((await row(p.id)).status).toBe('refunded');
  });

  it('an RPC error on one pledge is noted; the others go on', async () => {
    const { ctx, run, row, active, attest } = await setup();
    const broken = await active({ sponsor: wallet() });
    const fine = await active();
    await attest(ATTESTATION_VERIFIED, 10);
    ctx.poolChain.failingPledgePdas.add(broken.pdaAddress);
    const pass = await run();
    expect(pass.errors).toEqual([{ pledgeId: broken.id, note: expect.stringMatching(/unavailable/) }]);
    expect(pass.settled).toBe(1);
    expect((await row(fine.id)).status).toBe('settled');
    expect((await row(broken.id)).status).toBe('active');
    ctx.poolChain.failingPledgePdas.clear();
    await run();
    expect((await row(broken.id)).status).toBe('settled');
  });

  it('a settle another sender got in first: the row follows the chain, nothing is paid twice', async () => {
    const { ctx, sponsor, driver, run, row, active, attest, payout } = await setup();
    const p = await active({ lamportsPerKm: 1_000n, targetKm: 10 });
    await attest(ATTESTATION_VERIFIED, 4);
    ctx.poolChain.addPledgeTransaction([{ kind: 'PledgeSettled', rideId: p.rideId, sponsor, driver, pool: 'pool1', verifiedKm: 4, earnedLamports: 4_000n, refundedLamports: 6_000n }]);
    await run();
    expect(payout.calls).toEqual([]);
    expect(await row(p.id)).toMatchObject({ status: 'settled', earnedLamports: 4_000n });
  });
});

