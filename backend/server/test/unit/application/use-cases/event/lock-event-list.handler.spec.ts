import { LockEventListHandler } from '../../../../../src/application/use-cases/event/lock-event-list/lock-event-list.handler.js';
import { LockEventListCommand } from '../../../../../src/application/use-cases/event/lock-event-list/lock-event-list.command.js';
import { PRESEASON_EVENT_ID } from '../../../../../src/domain/prize/event-settlement.js';
import { testAdmin } from '../../../../support/admin-fixtures.js';
import { eventUnit } from '../../../../support/event-fixtures.js';
import { unitContext } from '../../../../support/unit-context.js';

const setup = async () => {
  const ctx = unitContext(), ev = eventUnit(ctx), admin = testAdmin(ctx);
  await ev.schedule();
  await ev.rideOf('a', 9000); await ev.rideOf('ru', 9900, { country: 'RU' }); await ev.rideOf('b', 8000); await ev.rideOf('c', 8000);
  return { ctx, ev, admin, handler: new LockEventListHandler(ev.view, ev.repo, ctx.proofs, ctx.adminActions, ctx.transactions, ctx.clock), sign: () => admin.sign({ action: 'event_lock', eventId: PRESEASON_EVENT_ID }) };
};

describe('LockEventListHandler', () => {
  it('refuses while appeals are open, without a schedule, then freezes places and cents (RU not paid, ties split)', async () => {
    const { ctx, ev, admin, handler, sign } = await setup();
    await expect(handler.execute(new LockEventListCommand(admin.wallet, null, await sign()))).rejects.toMatchObject({ errorCode: 'event_appeals_open' });
    ctx.clock.advance(2001);
    const dto = await handler.execute(new LockEventListCommand(admin.wallet, 'req', await sign()));
    expect(dto).toMatchObject({ winners: 3, paidCents: 10000 + 6000 + 6000, organizerCents: 50000 - 22000 });
    expect((await ev.repo.winners(PRESEASON_EVENT_ID)).map((w) => [w.wallet, w.place, w.amountCents, w.txSignature])).toEqual([['a', 1, 10000, null], ['b', 2, 6000, null], ['c', 2, 6000, null]]);
    expect(ctx.db.adminActions[0]).toMatchObject({ action: 'event.lock', detail: { paidCents: 22000 } });
    await expect(handler.execute(new LockEventListCommand(admin.wallet, null, await sign()))).rejects.toMatchObject({ errorCode: 'event_locked' });
  });

  it('a missing or inverted schedule is no lock; a wrong signature is a 401', async () => {
    const { ctx, admin, handler, sign } = await setup();
    await ctx.settingsRepo.upsert('event_review_end_utc', 0);
    ctx.clock.advance(5000);
    await expect(handler.execute(new LockEventListCommand(admin.wallet, null, await sign()))).rejects.toMatchObject({ errorCode: 'event_schedule_missing' });
    await expect(handler.execute(new LockEventListCommand(admin.wallet, null, 'nope'))).rejects.toMatchObject({ statusCode: 401 });
  });
});
