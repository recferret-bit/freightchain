import { ReviewEventWalletHandler } from '../../../../../src/application/use-cases/event/review-event-wallet/review-event-wallet.handler.js';
import { ReviewEventWalletCommand } from '../../../../../src/application/use-cases/event/review-event-wallet/review-event-wallet.command.js';
import { PRESEASON_EVENT_ID } from '../../../../../src/domain/prize/event-settlement.js';
import { testAdmin } from '../../../../support/admin-fixtures.js';
import { eventUnit } from '../../../../support/event-fixtures.js';
import { unitContext } from '../../../../support/unit-context.js';

const setup = async () => {
  const ctx = unitContext(), ev = eventUnit(ctx), admin = testAdmin(ctx);
  await ev.schedule(); await ev.rideOf('a', 9000);
  const handler = new ReviewEventWalletHandler(ev.view, ev.repo, ctx.proofs, ctx.adminActions, ctx.transactions, ctx.clock);
  return { ctx, ev, admin, handler };
};

describe('ReviewEventWalletHandler', () => {
  it('stores the signed flags, keeps earlier sanctions evidence and audits before/after', async () => {
    const { ctx, ev, admin, handler } = await setup();
    await ev.repo.saveReview(PRESEASON_EVENT_ID, { wallet: 'a', disqualified: false, prizeEligibleOverride: null, note: null, sanctionsCheckedAt: ctx.now(), sanctionsClean: true, sanctionsRef: 'r', updatedBy: 'x', updatedAt: ctx.now() }, undefined as never);
    const signature = await admin.sign({ action: 'event_review', wallet: 'a', disqualified: true, prizeEligible: false, note: 'two wallets' });
    const saved = await handler.execute(new ReviewEventWalletCommand(admin.wallet, 'a', true, false, 'two wallets', 'req', signature));
    expect(saved).toMatchObject({ disqualified: true, prizeEligibleOverride: false, note: 'two wallets', sanctionsClean: true, updatedBy: admin.wallet });
    expect(ctx.db.adminActions[0]).toMatchObject({ action: 'event.review', target: 'a', beforeState: { disqualified: false }, afterState: { disqualified: true }, requestId: 'req' });
  });

  it('refuses a stranger wallet, a locked list and a signature for another change', async () => {
    const { ctx, ev, admin, handler } = await setup();
    await expect(handler.execute(new ReviewEventWalletCommand(admin.wallet, 'ghost', true, null, null, null, await admin.sign({ action: 'event_review', wallet: 'ghost', disqualified: true, prizeEligible: null, note: null })))).rejects.toMatchObject({ errorCode: 'event_candidate_not_found' });
    await expect(handler.execute(new ReviewEventWalletCommand(admin.wallet, 'a', true, null, null, null, await admin.sign({ action: 'event_review', wallet: 'a', disqualified: false, prizeEligible: null, note: null })))).rejects.toMatchObject({ statusCode: 401 });
    await ev.repo.lock(PRESEASON_EVENT_ID, 'adm', ctx.now(), [], undefined as never);
    await expect(handler.execute(new ReviewEventWalletCommand(admin.wallet, 'a', true, null, null, null, await admin.sign({ action: 'event_review', wallet: 'a', disqualified: true, prizeEligible: null, note: null })))).rejects.toMatchObject({ errorCode: 'event_locked' });
    expect(ctx.db.adminActions).toEqual([]);
  });
});
