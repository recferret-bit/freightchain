import { RecordEventPayoutHandler } from '../../../../../src/application/use-cases/event/record-event-payout/record-event-payout.handler.js';
import { RecordEventPayoutCommand } from '../../../../../src/application/use-cases/event/record-event-payout/record-event-payout.command.js';
import { PRESEASON_EVENT_ID } from '../../../../../src/domain/prize/event-settlement.js';
import { testAdmin } from '../../../../support/admin-fixtures.js';
import { eventUnit } from '../../../../support/event-fixtures.js';
import { unitContext } from '../../../../support/unit-context.js';

const setup = async () => {
  const ctx = unitContext(), ev = eventUnit(ctx), admin = testAdmin(ctx);
  await ev.schedule(); await ev.rideOf('a', 9000); await ev.rideOf('b', 8000);
  ctx.clock.advance(2001);
  await ev.repo.lock(PRESEASON_EVENT_ID, 'adm', ctx.now(), [
    { wallet: 'a', place: 1, amountCents: 10000, bps: 9000, rideId: 'ra', lockedAt: ctx.now(), txSignature: null, paidAt: null, recordedBy: null },
    { wallet: 'b', place: 2, amountCents: 7000, bps: 8000, rideId: 'rb', lockedAt: ctx.now(), txSignature: null, paidAt: null, recordedBy: null },
  ], undefined as never);
  const clean = (wallet: string) => ev.repo.saveReview(PRESEASON_EVENT_ID, { wallet, disqualified: false, prizeEligibleOverride: null, note: null, sanctionsCheckedAt: ctx.now(), sanctionsClean: true, sanctionsRef: 'r', updatedBy: 'x', updatedAt: ctx.now() }, undefined as never);
  const handler = new RecordEventPayoutHandler(ev.repo, ctx.players, ctx.settings, ctx.proofs, ctx.adminActions, ctx.transactions, ctx.clock);
  const pay = async (wallet: string, tx: string) => handler.execute(new RecordEventPayoutCommand(admin.wallet, wallet, tx, 'req', await admin.sign({ action: 'event_payout', wallet, txSignature: tx })));
  return { ctx, ev, admin, clean, pay };
};

describe('RecordEventPayoutHandler', () => {
  it('records the transaction with the amount and place of the LOCKED list and audits it', async () => {
    const { ctx, clean, pay } = await setup();
    await clean('a');
    expect(await pay('a', 'sigA')).toEqual({ wallet: 'a', place: 1, amountCents: 10000, txSignature: 'sigA', solscanUrl: 'https://solscan.io/tx/sigA' });
    expect(ctx.db.adminActions[0]).toMatchObject({ action: 'event.payout', target: 'a', detail: { place: 1, amountCents: 10000, txSignature: 'sigA' } });
  });

  it('needs a clean check under 24 h old: none, not clean and stale are all refused', async () => {
    const { ctx, ev, clean, pay } = await setup();
    await expect(pay('a', 's1')).rejects.toMatchObject({ errorCode: 'event_sanctions_stale' });
    await ev.repo.saveReview(PRESEASON_EVENT_ID, { wallet: 'a', disqualified: false, prizeEligibleOverride: null, note: null, sanctionsCheckedAt: ctx.now(), sanctionsClean: false, sanctionsRef: 'r', updatedBy: 'x', updatedAt: ctx.now() }, undefined as never);
    await expect(pay('a', 's1')).rejects.toMatchObject({ errorCode: 'event_sanctions_stale' });
    await clean('a');
    ctx.clock.advance(24 * 3600 + 1);
    await expect(pay('a', 's1')).rejects.toMatchObject({ errorCode: 'event_sanctions_stale' });
    await clean('a');
    await expect(pay('a', 's1')).resolves.toMatchObject({ amountCents: 10000 });
  });

  it('Trust below 50 blocks only the payout, never the place', async () => {
    const { ctx, ev, clean, pay } = await setup();
    await clean('a');
    const p = await ctx.storedPlayer('a'); p.setTrustScore(49); await ctx.players.save(p);
    await expect(pay('a', 's1')).rejects.toMatchObject({ errorCode: 'event_trust_low' });
    expect((await ev.repo.winners(PRESEASON_EVENT_ID))[0]).toMatchObject({ wallet: 'a', place: 1, txSignature: null });
    const again = await ctx.storedPlayer('a'); again.setTrustScore(50); await ctx.players.save(again);
    await expect(pay('a', 's1')).resolves.toBeDefined();
  });

  it('once per winner and once per signature; a stranger, an open lock and open appeals are refused', async () => {
    const { ctx, clean, pay } = await setup();
    await clean('a'); await clean('b');
    await pay('a', 's1');
    await expect(pay('a', 's2')).rejects.toMatchObject({ errorCode: 'event_already_paid' });
    await expect(pay('b', 's1')).rejects.toMatchObject({ errorCode: 'event_signature_used' });
    await expect(pay('ghost', 's3')).rejects.toMatchObject({ errorCode: 'event_winner_not_found' });
    await ctx.settingsRepo.upsert('event_appeals_end_utc', Math.floor(ctx.clock.ms / 1000) + 10);
    await expect(pay('b', 's4')).rejects.toMatchObject({ errorCode: 'event_appeals_open' });
  });

  it('nothing before the lock', async () => {
    const ctx = unitContext(), ev = eventUnit(ctx), admin = testAdmin(ctx);
    await ev.schedule(); await ctx.player('a');
    ctx.clock.advance(2001);
    const handler = new RecordEventPayoutHandler(ev.repo, ctx.players, ctx.settings, ctx.proofs, ctx.adminActions, ctx.transactions, ctx.clock);
    await expect(handler.execute(new RecordEventPayoutCommand(admin.wallet, 'a', 's', null, await admin.sign({ action: 'event_payout', wallet: 'a', txSignature: 's' })))).rejects.toMatchObject({ errorCode: 'event_not_locked' });
  });
});
