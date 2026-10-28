import { GetAdminEventHandler } from '../../../../../src/application/use-cases/event/get-admin-event/get-admin-event.handler.js';
import { PRESEASON_EVENT_ID } from '../../../../../src/domain/prize/event-settlement.js';
import { eventUnit } from '../../../../support/event-fixtures.js';
import { unitContext } from '../../../../support/unit-context.js';

describe('GetAdminEventHandler', () => {
  it('reports the default table, the money split and the candidates; then the locked winners', async () => {
    const ctx = unitContext(), ev = eventUnit(ctx), handler = new GetAdminEventHandler(ev.view);
    expect(await handler.execute()).toMatchObject({ eventId: PRESEASON_EVENT_ID, phase: 'pending', reviewEnd: null, tableIsDefault: true, locked: false, candidates: [], winners: [] });
    await ev.schedule(); await ev.rideOf('a', 9000);
    const dto = await handler.execute();
    expect(dto.prizeTableCents).toHaveLength(20);
    expect(dto).toMatchObject({ paidCents: 10000, organizerCents: 40000, candidates: [{ wallet: 'a', place: 1, amountCents: 10000 }] });
    await ev.repo.lock(PRESEASON_EVENT_ID, 'adm', ctx.now(), [{ wallet: 'a', place: 1, amountCents: 10000, bps: 9000, rideId: 'r', lockedAt: ctx.now(), txSignature: 'sig', paidAt: ctx.now(), recordedBy: 'adm' }], undefined as never);
    expect(await handler.execute()).toMatchObject({ locked: true, phase: 'final', winners: [{ wallet: 'a', txSignature: 'sig', paidAt: ctx.now().getTime() }] });
  });
});
