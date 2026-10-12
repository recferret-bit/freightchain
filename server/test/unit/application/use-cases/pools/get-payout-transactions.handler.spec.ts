import { GetPayoutTransactionsHandler } from '../../../../../src/application/use-cases/pools/get-payout-transactions/get-payout-transactions.handler.js';
import { GetPayoutTransactionsQuery } from '../../../../../src/application/use-cases/pools/get-payout-transactions/get-payout-transactions.query.js';
import { ForbiddenError } from '../../../../../src/domain/shared/errors.js';
import { TREASURY } from '../../../../support/fake-chain.js';
import { unitContext, unitRules } from '../../../../support/unit-context.js';
import { aPool } from '../../../../support/pools.js';
import { poolRide } from '../../../../support/pool-rides.js';
import { AttestationService } from '../../../../../src/application/services/attestation.service.js';
import { FakePoolPayoutChain } from '../../../../support/fake-pool-payout-chain.js';

const ADMIN = TREASURY; // unitRules' treasury = the pool authority

describe('GetPayoutTransactionsHandler', () => {
  const setup = async () => {
    const ctx = unitContext(unitRules({ verdictEnforce: false })); // shadow mode for the boards – the payout still ranks only verified rides
    // 10 tickets × 0.05 SOL = 0.5 SOL pot → prize 70 % = 0.35 SOL
    await ctx.pools.upsert(aPool({ id: 1, status: 'active', ticketsSold: 10, minTickets: 2 }, ctx.now()));
    const completed = async (wallet: string, metres: number, poolId = 1) => { await poolRide(ctx, wallet, metres, 'verified', poolId); };
    const attestation = new AttestationService(new FakePoolPayoutChain(ctx.poolChain), ctx.rides, ctx.batches, ctx.hasher);
    const h = new GetPayoutTransactionsHandler(ctx.pools, ctx.rideQuery, ctx.chainEvents, ctx.poolChain, ctx.rules, ctx.clock, attestation);
    return { ctx, completed, payout: (wallet = ADMIN) => h.execute(new GetPayoutTransactionsQuery(wallet, 1)) };
  };

  it('after the play deadline: ranked payouts as pay_prize transactions for the admin to sign; no close until every rank is paid', async () => {
    const { ctx, completed, payout } = await setup();
    await completed('alice', 900); await completed('bob', 500); await completed('bob', 500); await completed('carol', 100, 2);
    await poolRide(ctx, 'dave', 5_000, 'flagged'); // not verified: never paid, whatever VERDICT_ENFORCE says
    ctx.clock.advance(15 * 86_400);
    const dto = await payout();
    expect(dto.prizeLamports).toBe(350_000_000);
    expect(dto.ranks).toEqual([
      { rank: 1, wallet: 'bob', distance: 1000, rides: 2, lamports: 125_000_000 + 50_000_000, paid: false },
      { rank: 2, wallet: 'alice', distance: 900, rides: 1, lamports: 75_000_000 + 50_000_000, paid: false },
    ]);
    expect(dto.transactions.map((t) => [t.rank, t.to, t.lamports])).toEqual([[1, 'bob', 175_000_000], [2, 'alice', 125_000_000]]);
    expect(ctx.poolChain.built.map((b) => b.kind)).toEqual(['pay_prize', 'pay_prize']);
    expect(ctx.poolChain.built[0]?.input).toMatchObject({ authority: ADMIN, poolId: 1, to: 'bob', lamports: 175_000_000, rank: 1 });
    expect(ctx.poolChain.built.map((b) => b.input['attest'])).toEqual([undefined, undefined]); // rides under 1 km: no VERIFIED attestation is ever offered
    expect(dto.close).toBeNull();
  });

  it('a winner with a verified ride of at least 1 km gets its record_attestation facts in front of the pay_prize (program v3 pays no prize without one)', async () => {
    const { ctx, completed, payout } = await setup();
    await completed('alice', 2_400);
    ctx.clock.advance(15 * 86_400);
    await payout();
    const attest = ctx.poolChain.built[0]?.input['attest'] as { telemetryRoot: Uint8Array; verifiedKm: number };
    expect(attest.verifiedKm).toBe(2);
    expect(attest.telemetryRoot).toHaveLength(32);
    expect(Buffer.from(attest.telemetryRoot).every((b) => b === 0)).toBe(false);
  });

  it('ranks already paid on chain are left out; with none left the close_pool transaction is offered', async () => {
    const { ctx, completed, payout } = await setup();
    await completed('alice', 900);
    ctx.clock.advance(15 * 86_400);
    await ctx.chainEvents.record({ signature: 's', index: 0, kind: 'PrizePaid', poolId: 1, wallet: 'alice', orderId: null, lamports: 300_000_000, outcome: 'applied', detail: null, at: ctx.now(), finalizedAt: null, lastValidBlockHeight: null });
    const dto = await payout();
    expect(dto.ranks[0]).toMatchObject({ wallet: 'alice', paid: true });
    expect(dto.transactions).toEqual([]);
    expect(dto.close).not.toBeNull();
  });

  it('refuses: not the admin (403), before the play deadline or a pool that is not live (409)', async () => {
    const { ctx, payout } = await setup();
    await expect(payout('someone')).rejects.toBeInstanceOf(ForbiddenError);
    await expect(payout()).rejects.toMatchObject({ errorCode: 'too_early' });
    await ctx.pools.upsert(aPool({ id: 1, status: 'refunding' }, ctx.now()));
    await expect(payout()).rejects.toMatchObject({ errorCode: 'not_payable' });
  });
});
