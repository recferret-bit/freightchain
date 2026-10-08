import { FinalityService } from '../../../../../src/application/services/finality.service.js';
import { PollProgramCommand } from '../../../../../src/application/use-cases/chain/poll-program/poll-program.command.js';
import { PollProgramHandler } from '../../../../../src/application/use-cases/chain/poll-program/poll-program.handler.js';
import { SettleChainSignatureCommand } from '../../../../../src/application/use-cases/chain/settle-chain-signature/settle-chain-signature.command.js';
import { SettleChainSignatureHandler } from '../../../../../src/application/use-cases/chain/settle-chain-signature/settle-chain-signature.handler.js';
import { BadRequestError, ServiceUnavailableError } from '../../../../../src/domain/shared/errors.js';
import { TREASURY } from '../../../../support/fake-chain.js';
import { aPool } from '../../../../support/pools.js';
import { unitContext } from '../../../../support/unit-context.js';

const BUYER = TREASURY;

describe('PollProgramHandler', () => {
  const setup = async () => {
    const ctx = unitContext();
    const settleHandler = new SettleChainSignatureHandler(ctx.poolChain, ctx.chainEvents, ctx.ticketSettlement, ctx.registry, ctx.clock);
    const sent: string[] = [];
    let fail: ((sig: string) => Error | null) = () => null;
    const bus = {
      execute: async (c: SettleChainSignatureCommand) => {
        sent.push(c.signature);
        const e = fail(c.signature);
        if (e) throw e;
        return settleHandler.execute(c);
      },
    };
    const finality = new FinalityService(ctx.poolChain, ctx.chainEvents, ctx.orders, ctx.players, ctx.pools, ctx.tickets, ctx.registry, ctx.transactions, ctx.clock);
    const handler = new PollProgramHandler(ctx.poolChain, ctx.chainCursors, bus as never, finality, ctx.clock);
    await ctx.pools.upsert(aPool({ id: 1, status: 'open', minTickets: 10 }, ctx.now()));
    const buy = (n: number) => ctx.poolChain.addEvent('TicketBought', { poolId: 1, buyer: BUYER, qty: 1, lamports: 50_000_000, orderId: '', ticketsSold: n, activated: false });
    return { ctx, handler, sent, buy, poll: (pageSize?: number) => handler.execute(new PollProgramCommand(pageSize)), setFail: (f: typeof fail) => { fail = f; } };
  };

  it('settles every new transaction oldest first, moves the cursor to the last, and a second poll finds nothing new', async () => {
    const { ctx, sent, buy, poll } = await setup();
    const sigs = [buy(1), buy(2), buy(3)];
    const r = await poll();
    expect(r).toMatchObject({ settled: 3, skipped: 0, pendingAt: null, cursor: sigs[2], errors: [], finality: { checked: 3, waiting: 3 } });
    expect(sent).toEqual(sigs);
    expect(await ctx.chainCursors.get('program')).toMatchObject({ signature: sigs[2], slot: 3, at: ctx.now() });
    expect((await ctx.tickets.find(BUYER, 1))?.balance).toBe(3);
    sent.length = 0;
    expect(await poll()).toMatchObject({ settled: 0, cursor: sigs[2] });
    expect(sent).toEqual([]);
  });

  it('first boot (no cursor) replays the newest history oldest first; then pages through a backlog larger than one page', async () => {
    const { sent, buy, poll } = await setup();
    const first = Array.from({ length: 3 }, (_, i) => buy(i + 1));
    expect(await poll(2)).toMatchObject({ settled: 3, cursor: first[2] });
    expect(sent).toEqual(first);
    sent.length = 0;
    const sigs = Array.from({ length: 5 }, (_, i) => buy(i + 4));
    expect(await poll(2)).toMatchObject({ settled: 5, cursor: sigs[4] });
    expect(sent).toEqual(sigs);
  });

  it('a failed transaction is passed over without settling; an invalid one moves the cursor too', async () => {
    const { ctx, sent, buy, poll } = await setup();
    const a = buy(1);
    ctx.poolChain.signatures.push({ signature: 'failed-tx', slot: 50, failed: true });
    ctx.poolChain.events.set('foreign', { invalid: 'not a pool program transaction' });
    ctx.poolChain.signatures.push({ signature: 'foreign', slot: 51, failed: false });
    const r = await poll();
    expect(r).toMatchObject({ settled: 1, skipped: 2, cursor: 'foreign' });
    expect(sent).toEqual([a, 'foreign']);
  });

  it('a pending transaction stops the batch there: the cursor stays before it, and it is the first one asked next poll', async () => {
    const { ctx, sent, buy, poll } = await setup();
    const a = buy(1);
    ctx.poolChain.signatures.push({ signature: 'not-yet', slot: 60, failed: false }); // no events scripted → pending
    const c = buy(2);
    expect(await poll()).toMatchObject({ settled: 1, pendingAt: 'not-yet', cursor: a });
    expect(sent).toEqual([a, 'not-yet']);
    ctx.poolChain.events.set('not-yet', [{ kind: 'Sponsored', signature: 'not-yet', index: 0, slot: 60, poolId: 1, sponsor: BUYER, lamports: 5, sponsoredTotal: 5 }]);
    sent.length = 0;
    expect(await poll()).toMatchObject({ settled: 2, pendingAt: null, cursor: c });
    expect(sent).toEqual(['not-yet', c]);
  });

  it('a deterministic error is reported and passed over; a transient one stops the poll and keeps the cursor before it', async () => {
    const { ctx, buy, poll, setFail } = await setup();
    const a = buy(1), b = buy(2);
    setFail((s) => (s === a ? new BadRequestError('pool 1: unknown tier code 9', 'bad_pool') : null));
    expect(await poll()).toMatchObject({ settled: 1, cursor: b, errors: [{ signature: a, message: 'pool 1: unknown tier code 9' }] });
    const c = buy(3);
    setFail((s) => (s === c ? new ServiceUnavailableError('Solana RPC unavailable') : null));
    await expect(poll()).rejects.toBeInstanceOf(ServiceUnavailableError);
    expect((await ctx.chainCursors.get('program'))?.signature).toBe(b);
  });

  it('runs the finality pass after settling', async () => {
    const { ctx, buy, poll } = await setup();
    const a = buy(1);
    ctx.poolChain.statuses.set(a, 'finalized');
    expect((await poll()).finality).toEqual({ checked: 1, finalized: 1, dropped: 0, waiting: 0 });
    expect((await ctx.chainEvents.find(a, 0))?.finalizedAt).not.toBeNull();
  });
});
