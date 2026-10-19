import { Keypair } from '@solana/web3.js';
import { GetPayoutTransactionsHandler } from '../../../../../src/application/use-cases/pools/get-payout-transactions/get-payout-transactions.handler.js';
import { GetPayoutTransactionsQuery } from '../../../../../src/application/use-cases/pools/get-payout-transactions/get-payout-transactions.query.js';
import type { PoolChainState } from '../../../../../src/domain/economy/chain-events.js';
import { rootFromProof, winnerLeaf, winnersTree } from '../../../../../src/domain/economy/winners-merkle.js';
import { ForbiddenError, NotFoundError } from '../../../../../src/domain/shared/errors.js';
import { TREASURY } from '../../../../support/fake-chain.js';
import { unitContext, unitRules } from '../../../../support/unit-context.js';
import { aPool, chainPool } from '../../../../support/pools.js';
import { poolRide } from '../../../../support/pool-rides.js';
import { VerdictStatus } from '../../../../../src/domain/verdict/verdict.dto.js';

const ADMIN = TREASURY; // unitRules' treasury = the pool authority
const wallet = () => Keypair.generate().publicKey.toBase58(); // a winners leaf holds the wallet's 32 bytes: ranked wallets are real addresses
const DAY = 86_400;

describe('GetPayoutTransactionsHandler', () => {
  const setup = async () => {
    const ctx = unitContext(unitRules({ verdictEnforce: false })); // shadow mode for the boards – the payout still ranks only verified rides
    // 10 tickets × 0.05 SOL = 0.5 SOL pot → prize 70 % = 0.35 SOL
    const pool = aPool({ id: 1, status: 'active', ticketsSold: 10, minTickets: 2 }, ctx.now());
    await ctx.pools.upsert(pool);
    ctx.poolChain.pools.set(1, chainPool(ctx.now(), { poolId: 1, status: 'active', ticketsSold: 10, playDeadline: pool.playDeadline, payoutAt: pool.payoutAt, winnersRoot: null, paidMask: 0n }));
    const completed = async (w: string, metres: number, poolId = 1) => { await poolRide(ctx, w, metres, 'verified', poolId); };
    const h = new GetPayoutTransactionsHandler(ctx.pools, ctx.rideQuery, ctx.poolChain, ctx.rules, ctx.clock, ctx.hasher);
    const sha = (d: Uint8Array) => ctx.hasher.sha256(d);
    /** the chain pool after a commit of these winners (rank order), its lock ending `payFrom` */
    const committed = (list: { wallet: string; lamports: number }[], over: Partial<PoolChainState> = {}) => {
      const tree = winnersTree(1, list, sha);
      ctx.poolChain.pools.set(1, { ...ctx.poolChain.pools.get(1)!, winnersRoot: tree.root.toString('base64'), winnersTotal: tree.total, winnersCount: list.length, committedAt: ctx.now(), payFrom: ctx.now(), paidMask: 0n, ...over });
      return tree;
    };
    return { ctx, completed, committed, sha, payout: (w = ADMIN) => h.execute(new GetPayoutTransactionsQuery(w, 1)) };
  };
  /** bob 1 000 m over two rides, alice 900 m: 25 + 10 parts of 70 → 175 / 125 m SOL */
  const twoWinners = async (s: Awaited<ReturnType<typeof setup>>) => {
    const [alice, bob] = [wallet(), wallet()];
    await s.completed(alice, 900); await s.completed(bob, 500); await s.completed(bob, 500); await s.completed(wallet(), 100, 2);
    s.ctx.clock.advance(15 * DAY);
    return { alice, bob, plan: [{ wallet: bob, lamports: 175_000_000 }, { wallet: alice, lamports: 125_000_000 }] };
  };

  it('after the play deadline: the ranking is COMMITTED first (commit_winners of its root) – nothing paid, no veto, no close', async () => {
    const s = await setup();
    const { ctx, completed, payout, sha } = s;
    const [alice, bob, dave] = [wallet(), wallet(), wallet()];
    await completed(alice, 900); await completed(bob, 500); await completed(bob, 500); await completed(wallet(), 100, 2);
    const flagged = await poolRide(ctx, dave, 5_000, 'flagged');
    ctx.clock.advance(15 * DAY);
    await expect(payout()).rejects.toMatchObject({ errorCode: 'waiting_review' });   // an undecided ride holds the manual payout too (the payout job's gate)
    const { RideVerdict } = await import('../../../../../src/domain/verdict/ride-verdict.entity.js');
    await ctx.verdictRepo.save(RideVerdict.restore({ ...(await ctx.verdictRepo.findByRide(flagged))!.snapshot(), status: VerdictStatus.Rejected, overriddenBy: 'Admin', overriddenAt: ctx.now(), note: null }));   // decided: never paid, whatever VERDICT_ENFORCE says
    const dto = await payout();
    expect(dto.prizeLamports).toBe(350_000_000);
    expect(dto.ranks).toEqual([
      { rank: 1, wallet: bob, distance: 1000, rides: 2, lamports: 125_000_000 + 50_000_000, paid: false },
      { rank: 2, wallet: alice, distance: 900, rides: 1, lamports: 75_000_000 + 50_000_000, paid: false },
    ]);
    const tree = winnersTree(1, [{ wallet: bob, lamports: 175_000_000 }, { wallet: alice, lamports: 125_000_000 }], sha);
    expect(ctx.poolChain.built.map((b) => b.kind)).toEqual(['commit_winners']);
    expect(ctx.poolChain.built[0]?.input).toEqual({ authority: ADMIN, poolId: 1, root: tree.root.toString('base64'), total: 300_000_000, count: 2 });
    expect(dto.commit).toMatchObject({ transaction: expect.any(String), message: expect.any(String), lastValidBlockHeight: 250 });
    expect(dto).toMatchObject({ committedRoot: null, payFrom: null, veto: null, transactions: [], close: null, note: expect.stringMatching(/^commit the winners/) });
  });

  it('no verified ride ranks: a commit of NO winner (zero root, count 0) so the pool can close', async () => {
    const { ctx, payout } = await setup();
    ctx.clock.advance(15 * DAY);
    const dto = await payout();
    expect(dto.ranks).toEqual([]);
    expect(ctx.poolChain.built[0]?.input).toEqual({ authority: ADMIN, poolId: 1, root: Buffer.alloc(32).toString('base64'), total: 0, count: 0 });
    expect(dto.note).toMatch(/no verified ride ranks/);
  });

  it('a committed root that is not the ranking: veto_winners + a note while no rank is paid; once one is paid, only the note', async () => {
    const s = await setup();
    const { ctx, payout, committed } = s;
    const { plan } = await twoWinners(s);
    committed([plan[1]!, plan[0]!]);   // the ranking moved after the commit
    const dto = await payout();
    expect(ctx.poolChain.built.map((b) => b.kind)).toEqual(['veto_winners']);
    expect(ctx.poolChain.built[0]?.input).toEqual({ authority: ADMIN, poolId: 1 });
    expect(dto).toMatchObject({ commit: null, veto: { transaction: expect.any(String) }, transactions: [], close: null, note: expect.stringMatching(/veto them, then commit the ranking/) });
    expect(dto.committedRoot).toBe(ctx.poolChain.pools.get(1)!.winnersRoot);
    ctx.poolChain.built.length = 0;
    committed([plan[1]!, plan[0]!], { paidMask: 1n });
    const paid = await payout();
    expect(ctx.poolChain.built).toEqual([]);
    expect(paid).toMatchObject({ veto: null, transactions: [], close: null, note: expect.stringMatching(/can no longer be vetoed/) });
    expect(paid.ranks[0]).toMatchObject({ rank: 1, paid: true });
  });

  it('the ranking committed, inside its lock (now < payFrom): no pay_prize, no close – only the veto (the admin\'s lever) and when it pays', async () => {
    const s = await setup();
    const { ctx, payout, committed } = s;
    const { plan } = await twoWinners(s);
    const payFrom = new Date(ctx.now().getTime() + 3_600_000);
    const tree = committed(plan, { payFrom });
    const dto = await payout();
    expect(ctx.poolChain.built.map((b) => b.kind)).toEqual(['veto_winners']);
    expect(dto).toMatchObject({ committedRoot: tree.root.toString('base64'), payFrom: payFrom.getTime(), commit: null, transactions: [], close: null });
    expect(dto.note).toBe(`the winners are public until ${payFrom.toISOString()} – prizes pay from then`);
  });

  it('after the lock: one pay_prize per rank with its Merkle proof, paid by the admin; no close until every rank is paid', async () => {
    const s = await setup();
    const { ctx, payout, committed, sha } = s;
    const { alice, bob, plan } = await twoWinners(s);
    const tree = committed(plan);
    const dto = await payout();
    expect(dto.transactions.map((t) => [t.rank, t.to, t.lamports])).toEqual([[1, bob, 175_000_000], [2, alice, 125_000_000]]);
    expect(ctx.poolChain.built.map((b) => b.kind)).toEqual(['veto_winners', 'pay_prize', 'pay_prize']);
    const pays = ctx.poolChain.built.filter((b) => b.kind === 'pay_prize').map((b) => b.input);
    expect(pays[0]).toEqual({ payer: ADMIN, poolId: 1, rank: 1, to: bob, lamports: 175_000_000, proof: tree.proofs[0]!.map((p) => p.toString('base64')) });
    expect(pays[1]).toMatchObject({ payer: ADMIN, rank: 2, to: alice, lamports: 125_000_000 });
    for (const [i, p] of pays.entries()) {   // each proof leads from its leaf (index rank − 1) to the committed root – what pay_prize checks
      const proof = (p['proof'] as string[]).map((x) => Buffer.from(x, 'base64'));
      expect(rootFromProof(winnerLeaf(1, i, plan[i]!, sha), i, 2, proof, sha)?.toString('base64')).toBe(dto.committedRoot);
    }
    expect(dto.close).toBeNull();
    expect(dto.note).toBeNull();
  });

  it('ranks the chain shows paid (paidMask) are left out; with none left the close_pool transaction is offered', async () => {
    const s = await setup();
    const { ctx, payout, committed } = s;
    const { alice, plan } = await twoWinners(s);
    committed(plan, { paidMask: 0b01n });
    const one = await payout();
    expect(one.ranks.map((r) => r.paid)).toEqual([true, false]);
    expect(one.transactions.map((t) => [t.rank, t.to])).toEqual([[2, alice]]);
    expect(one).toMatchObject({ veto: null, close: null });
    ctx.poolChain.built.length = 0;
    committed(plan, { paidMask: 0b11n });
    const done = await payout();
    expect(done.transactions).toEqual([]);
    expect(ctx.poolChain.built.map((b) => b.kind)).toEqual(['close_pool']);
    expect(ctx.poolChain.built[0]?.input).toEqual({ authority: ADMIN, poolId: 1 });
    expect(done.close).toMatchObject({ transaction: expect.any(String) });
  });

  it('refuses: not the admin (403), before the play deadline, a held pool or one that is not live (409), a pool not on chain (404)', async () => {
    const { ctx, payout } = await setup();
    await expect(payout('someone')).rejects.toBeInstanceOf(ForbiddenError);
    await expect(payout()).rejects.toMatchObject({ errorCode: 'too_early' });
    ctx.clock.advance(15 * DAY);
    const live = (await ctx.pools.findById(1))!.snapshot();
    await ctx.pools.saveHold(1, { by: 'Admin', at: ctx.now(), note: 'looking' });
    await expect(payout()).rejects.toMatchObject({ errorCode: 'held' });
    await ctx.pools.saveHold(1, null);
    ctx.poolChain.pools.delete(1);
    await expect(payout()).rejects.toBeInstanceOf(NotFoundError);
    await ctx.pools.upsert(aPool({ ...live, status: 'refunding' }));
    await expect(payout()).rejects.toMatchObject({ errorCode: 'not_payable' });
    expect(ctx.poolChain.built).toEqual([]);
  });
});
