import { describe, expect, it } from 'vitest';
import { ConfirmPledgeCommand } from '../../../../../src/application/use-cases/pledges/confirm-pledge/confirm-pledge.command.js';
import { ConfirmPledgeHandler } from '../../../../../src/application/use-cases/pledges/confirm-pledge/confirm-pledge.handler.js';
import { BadRequestError, NotFoundError } from '../../../../../src/domain/shared/errors.js';
import { unitContext } from '../../../../support/unit-context.js';
import { newPoolSignature } from '../../../../support/fake-pool-chain.js';
import { aPledge, createdEvent, wallet } from '../../../../support/pledges.js';

describe('ConfirmPledgeHandler – a pledge is active only when its transaction\'s own events say so', () => {
  const setup = async () => {
    const ctx = unitContext();
    const sponsor = wallet(), driver = wallet();
    await ctx.player(sponsor); await ctx.player(driver);
    const handler = new ConfirmPledgeHandler(ctx.pledges, ctx.players, ctx.poolChain, ctx.transactions, ctx.clock);
    return { ctx, sponsor, driver, confirm: (w: string, id: string, sig: string) => handler.execute(new ConfirmPledgeCommand(w, id, sig)) };
  };

  it('the PledgeCreated of this pledge with its terms → active with the create signature; a second confirm changes nothing', async () => {
    const { ctx, sponsor, driver, confirm } = await setup();
    const { pledge, createSig } = await aPledge(ctx, { sponsor, driver, onChain: true });
    expect(await confirm(sponsor, pledge.id, createSig!)).toMatchObject({ id: pledge.id, status: 'active', createSignature: createSig });
    expect(await confirm(sponsor, pledge.id, createSig!)).toMatchObject({ status: 'active', createSignature: createSig });
    expect((await ctx.pledges.findById(pledge.id))!.status).toBe('active');
  });

  it('a transaction the chain does not show yet: the row stays pending (ask again)', async () => {
    const { ctx, sponsor, driver, confirm } = await setup();
    const { pledge } = await aPledge(ctx, { sponsor, driver });
    expect(await confirm(sponsor, pledge.id, newPoolSignature())).toMatchObject({ status: 'pending' });
  });

  it('another pledge\'s transaction, other terms, a failed transaction → 400; nothing changes', async () => {
    const { ctx, sponsor, driver, confirm } = await setup();
    const { pledge } = await aPledge(ctx, { sponsor, driver });
    const { pledge: other, createSig: otherSig } = await aPledge(ctx, { sponsor, driver, onChain: true });
    await expect(confirm(sponsor, pledge.id, otherSig!)).rejects.toThrow(BadRequestError);
    const cheaper = ctx.poolChain.addPledgeTransaction([{ ...createdEvent(pledge), maxLamports: 1_000n, lamportsPerKm: 100n }]);
    await expect(confirm(sponsor, pledge.id, cheaper)).rejects.toThrow(/other terms/);
    const failed = newPoolSignature();
    ctx.poolChain.pledgeEvents.set(failed, { invalid: 'the transaction failed' });
    await expect(confirm(sponsor, pledge.id, failed)).rejects.toThrow(BadRequestError);
    expect((await ctx.pledges.findById(pledge.id))!.status).toBe('pending');
    expect((await ctx.pledges.findById(other.id))!.status).toBe('pending');
  });

  it('someone else\'s pledge and a missing id are the same 404 not_found', async () => {
    const { ctx, sponsor, driver, confirm } = await setup();
    const { pledge, createSig } = await aPledge(ctx, { sponsor, driver, onChain: true });
    const foreign = await confirm(driver, pledge.id, createSig!).then(() => null, (e) => e);
    const missing = await confirm(sponsor, '00000000-0000-4000-8000-000000000000', createSig!).then(() => null, (e) => e);
    expect(foreign).toBeInstanceOf(NotFoundError);
    expect(missing).toBeInstanceOf(NotFoundError);
    expect({ status: foreign.statusCode, code: foreign.errorCode, message: foreign.message }).toEqual({ status: 404, code: 'not_found', message: missing.message });
    expect(foreign.errorCode).toBe(missing.errorCode);
  });

  it('a transaction that already settled it (create + settle seen together) leaves it settled', async () => {
    const { ctx, sponsor, driver, confirm } = await setup();
    const { pledge } = await aPledge(ctx, { sponsor, driver, lamportsPerKm: 1_000n, targetKm: 10 });
    const sig = ctx.poolChain.addPledgeTransaction([createdEvent(pledge), { kind: 'PledgeRefunded', rideId: pledge.rideId, sponsor, driver, pool: 'pool1', refundedLamports: 10_000n }]);
    expect(await confirm(sponsor, pledge.id, sig)).toMatchObject({ status: 'refunded', refundedLamports: '10000', createSignature: sig });
  });
});
