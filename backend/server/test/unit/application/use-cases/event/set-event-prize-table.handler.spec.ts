import { SetEventPrizeTableHandler } from '../../../../../src/application/use-cases/event/set-event-prize-table/set-event-prize-table.handler.js';
import { SetEventPrizeTableCommand } from '../../../../../src/application/use-cases/event/set-event-prize-table/set-event-prize-table.command.js';
import { PRESEASON_EVENT_ID } from '../../../../../src/domain/prize/event-settlement.js';
import { testAdmin } from '../../../../support/admin-fixtures.js';
import { eventUnit } from '../../../../support/event-fixtures.js';
import { unitContext } from '../../../../support/unit-context.js';

describe('SetEventPrizeTableHandler', () => {
  const setup = () => { const ctx = unitContext(), ev = eventUnit(ctx), admin = testAdmin(ctx); return { ctx, ev, admin, handler: new SetEventPrizeTableHandler(ev.repo, ctx.proofs, ctx.adminActions, ctx.transactions, ctx.clock) }; };

  it('stores a signed table and audits the old and new one', async () => {
    const { ctx, ev, admin, handler } = setup();
    expect(await handler.execute(new SetEventPrizeTableCommand(admin.wallet, [700, 300], 'req', await admin.sign({ action: 'event_prize_table', cents: [700, 300] })))).toEqual({ prizeTableCents: [700, 300] });
    expect((await ev.repo.state(PRESEASON_EVENT_ID)).prizeTableCents).toEqual([700, 300]);
    expect(ctx.db.adminActions[0]).toMatchObject({ action: 'event.prize_table', beforeState: { prizeTableCents: null }, afterState: { prizeTableCents: [700, 300] } });
  });

  it('refuses an invalid table before the signature is spent, a changed table, and a locked list', async () => {
    const { ctx, ev, admin, handler } = setup();
    await expect(handler.execute(new SetEventPrizeTableCommand(admin.wallet, [], null, 'x'))).rejects.toMatchObject({ errorCode: 'bad_prize_table' });
    await expect(handler.execute(new SetEventPrizeTableCommand(admin.wallet, [1.5], null, 'x'))).rejects.toMatchObject({ errorCode: 'bad_prize_table' });
    await expect(handler.execute(new SetEventPrizeTableCommand(admin.wallet, [5], null, await admin.sign({ action: 'event_prize_table', cents: [6] })))).rejects.toMatchObject({ statusCode: 401 });
    await ev.repo.lock(PRESEASON_EVENT_ID, 'adm', ctx.now(), [], undefined as never);
    await expect(handler.execute(new SetEventPrizeTableCommand(admin.wallet, [5], null, await admin.sign({ action: 'event_prize_table', cents: [5] })))).rejects.toMatchObject({ errorCode: 'event_locked' });
    expect(ctx.db.adminActions).toEqual([]);
  });
});
