import { Keypair } from '@solana/web3.js';
import { Ride } from '../../../../../src/domain/rides/ride.entity.js';
import { ConfirmDonationHandler } from '../../../../../src/application/use-cases/live/confirm-donation/confirm-donation.handler.js';
import { ConfirmDonationCommand } from '../../../../../src/application/use-cases/live/confirm-donation/confirm-donation.command.js';
import { DonationOrder } from '../../../../../src/domain/live/donation-order.entity.js';
import { RideEvent } from '../../../../../src/domain/live/ride-event.entity.js';
import { EFFECTS, type EffectId } from '../../../../../src/domain/live/live-rules.js';
import type { ChainTransaction } from '../../../../../src/domain/economy/chain-transaction.js';
import { BadRequestError, ConflictError, NotFoundError } from '../../../../../src/domain/shared/errors.js';
import { unitContext, unitRules } from '../../../../support/unit-context.js';

describe('ConfirmDonationHandler', () => {
  const driver = Keypair.generate().publicKey.toBase58(), fan = Keypair.generate().publicKey.toBase58();
  const setup = async (effects: 'all' | 'off' = 'all') => {
    const ctx = unitContext(unitRules({ live: { chat: 'all', donations: true, freeDonations: false, effects } }));
    const handler = new ConfirmDonationHandler(ctx.donationOrders, ctx.rideEvents, ctx.rides, ctx.chain, ctx.rules, ctx.clock, ctx.stats);
    const ride = await ctx.paidRide(driver, true);
    const order = async (effect: EffectId = 'sinkhole') => { const o = DonationOrder.create({ id: ctx.entropy.uuid(), rideId: ride.id, wallet: fan, recipient: driver, effect, note: 'gg', now: ctx.now() }); await ctx.donationOrders.insert(o); return o; };
    const pay = (o: DonationOrder, over: { lamports?: number; destination?: string; memo?: string; extraTransfers?: ChainTransaction['transfers'] } = {}) => ctx.chain.addPayment({ payer: fan, destination: over.destination ?? driver, lamports: over.lamports ?? o.lamports, memo: over.memo ?? o.memo, extraTransfers: over.extraTransfers });
    const confirm = (o: DonationOrder, sig: string, wallet = fan) => handler.execute(new ConfirmDonationCommand(wallet, ride.id, o.id, sig));
    return { ctx, ride, order, pay, confirm };
  };

  it('pending until the transfer is on chain; then the donation enters the feed as paid (signature, amount) – a re-confirm answers the same event', async () => {
    const { ctx, ride, order, pay, confirm } = await setup();
    const o = await order();
    expect(await confirm(o, 'not-there-yet')).toEqual({ status: 'pending' });
    const sig = pay(o);
    const done = await confirm(o, sig);
    expect(done).toMatchObject({ status: 'paid', event: { kind: 'donation', effect: 'tip', lamports: EFFECTS.sinkhole.lamports, signature: sig, text: expect.stringMatching(/sinkhole is off on this ride/) } });
    expect(await confirm(o, sig)).toEqual(done);
    expect((await ctx.rideEvents.listAfter(ride.id, 0, 10)).length).toBe(1);
    expect((await ctx.donationOrders.findById(o.id))?.snapshot()).toMatchObject({ status: 'paid', signature: sig });
  });

  it('a transfer that does not pay this order is a 400 with why; one transfer cannot pay two orders; the order is the payer\'s own', async () => {
    const { order, pay, confirm } = await setup();
    const o = await order(), other = await order('tip');
    await expect(confirm(o, pay(o, { destination: Keypair.generate().publicKey.toBase58() }))).rejects.toThrow(new BadRequestError('no transfer of the donation from your wallet to the driver', 'bad_donation_payment'));
    await expect(confirm(o, pay(o, { memo: 'fc-donation:else' }))).rejects.toThrow(/memo does not match/);
    const sig = pay(o);
    await confirm(o, sig);
    await expect(confirm(other, sig)).rejects.toBeInstanceOf(ConflictError);
    await expect(confirm(o, pay(o))).rejects.toThrow(/already paid/);
    await expect(confirm(other, pay(other), 'stranger')).rejects.toBeInstanceOf(NotFoundError);
  });

  it('money that moved is never refused: inside another effect\'s window, with effects off, or after the ride ended it arrives as a TIP saying why', async () => {
    const busy = await setup();
    await busy.ctx.rideEvents.insert(RideEvent.donation({ rideId: busy.ride.id, wallet: 'x', effect: 'day', now: busy.ctx.now() }), 20_000);
    const o1 = await busy.order();
    const e1 = (await busy.confirm(o1, busy.pay(o1))) as { event: { effect: string; text: string; lamports: number } };
    expect(e1.event).toMatchObject({ effect: 'tip', lamports: EFFECTS.sinkhole.lamports });
    expect(e1.event.text).toMatch(/sinkhole is off on this ride, delivered as a tip/);
    const off = await setup('off');
    const o2 = await off.order('night');
    expect(((await off.confirm(o2, off.pay(o2))) as { event: { text: string } }).event.text).toMatch(/night is off on this ride, delivered as a tip/);
    const ended = await setup();
    const o3 = await ended.order('trench');
    ended.ride.finish('shift', null, ended.ctx.now()); await ended.ctx.rides.save(ended.ride);
    expect(((await ended.confirm(o3, ended.pay(o3))) as { event: { effect: string; text: string } }).event).toMatchObject({ effect: 'tip', text: expect.stringMatching(/arrived after the ride ended/) });
  });

  it('statistics: a paid donation counts once on the DRIVER with its lamports – a re-confirm and a pending answer add nothing', async () => {
    const { ctx, order, pay, confirm } = await setup();
    const o = await order();
    await confirm(o, 'not-there-yet');
    expect(await ctx.stats.player(driver)).toMatchObject({ donations: 0 });
    const sig = pay(o);
    await confirm(o, sig); await confirm(o, sig);
    expect(await ctx.stats.player(driver)).toMatchObject({ donations: 1, donationLamports: o.lamports });
    expect(await ctx.stats.player(fan)).toMatchObject({ donations: 0 });
    expect(await ctx.stats.global()).toMatchObject({ donations: 1, donationLamports: o.lamports });
  });

  it('a reserved share is counted on the referrer and the driver is credited the rest; a release during the chain read follows the transfer that landed', async () => {
    const { ctx, order, pay, confirm } = await setup();
    const referrer = Keypair.generate().publicKey.toBase58();
    const share = 1_000_000;
    const reserved = await order();
    const stored = await ctx.donationOrders.findById(reserved.id);
    if (!stored) throw new Error('order missing');
    stored.assignShare(referrer, share);
    await ctx.donationOrders.insert(stored); // same id overwrites the snapshot
    const split = (o: DonationOrder) => pay(o, { lamports: o.lamports - share, extraTransfers: [{ source: fan, destination: referrer, lamports: share }] });
    const sig = split(stored);
    await confirm(stored, sig);
    expect((await ctx.donationOrders.findById(stored.id))?.shareState).toBe('paid');
    expect(await ctx.stats.player(driver)).toMatchObject({ donations: 1, donationLamports: stored.lamports - share });

    const released = await order();
    const again = await ctx.donationOrders.findById(released.id);
    if (!again) throw new Error('order missing');
    again.assignShare(referrer, share);
    await ctx.donationOrders.insert(again);
    const late = await order();
    const third = await ctx.donationOrders.findById(late.id);
    if (!third) throw new Error('order missing');
    third.assignShare(referrer, share);
    await ctx.donationOrders.insert(third);
    let releasing = again.id;
    const original = ctx.chain.getTransaction.bind(ctx.chain);
    ctx.chain.getTransaction = async (signature: string) => { await ctx.donationOrders.releaseShare(releasing); return original(signature); };
    await confirm(again, pay(again));
    expect((await ctx.donationOrders.findById(again.id))?.shareState).toBe('released');
    expect(await ctx.stats.player(driver)).toMatchObject({ donations: 2, donationLamports: stored.lamports - share + again.lamports });
    releasing = third.id;
    await expect(confirm(third, split(third))).rejects.toThrow(/no transfer/);
    expect((await ctx.donationOrders.findById(third.id))?.shareState).toBe('released');
    expect((await ctx.donationOrders.findById(third.id))?.status).toBe('pending');
    expect(await ctx.stats.player(driver)).toMatchObject({ donations: 2, donationLamports: stored.lamports - share + again.lamports });
  });

  it('a confirm that dies after the claim still counts the referrer share on the retry', async () => {
    const { ctx, order, pay, confirm } = await setup();
    const referrer = Keypair.generate().publicKey.toBase58();
    const share = 1_000_000;
    const created = await order();
    const stored = await ctx.donationOrders.findById(created.id);
    if (!stored) throw new Error('order missing');
    stored.assignShare(referrer, share);
    await ctx.donationOrders.insert(stored);
    let calls = 0;
    const original = ctx.donationOrders.markSharePaid.bind(ctx.donationOrders);
    ctx.donationOrders.markSharePaid = async (id: string) => { if (++calls === 1) throw new Error('died'); return original(id); };
    const sig = pay(stored, { lamports: stored.lamports - share, extraTransfers: [{ source: fan, destination: referrer, lamports: share }] });
    await expect(confirm(stored, sig)).rejects.toThrow(/died/);
    expect((await ctx.donationOrders.findById(stored.id))?.status).toBe('paid');
    expect((await ctx.donationOrders.findById(stored.id))?.shareState).toBe('reserved');
    await confirm(stored, sig);
    expect((await ctx.donationOrders.findById(stored.id))?.shareState).toBe('paid');
    expect(await ctx.stats.player(driver)).toMatchObject({ donations: 1, donationLamports: stored.lamports - share });
  });

  it('a ranked ride delivers a paid road effect as a tip and does not change the road', async () => {
    const { ctx, ride, order, pay, confirm } = await setup();
    await ctx.rides.save(Ride.restore({ ...ride.snapshot(), ranked: true }));
    const o = await order('night');
    const done = (await confirm(o, pay(o))) as { event: { effect: string; text: string } };
    expect(done.event.effect).toBe('tip');
    expect(done.event.text).toMatch(/night is off on a ranked ride, delivered as a tip/);
  });

  it('statistics: money that moved is counted even when it arrives as a tip (the ride ended)', async () => {
    const { ctx, ride, order, pay, confirm } = await setup();
    const o = await order();
    const stored = await ctx.reload(ride.id); stored.finish('shift', null, ctx.now()); await ctx.rides.save(stored);
    await confirm(o, pay(o));
    expect(await ctx.stats.player(driver)).toMatchObject({ donations: 1, donationLamports: o.lamports });
  });
});
