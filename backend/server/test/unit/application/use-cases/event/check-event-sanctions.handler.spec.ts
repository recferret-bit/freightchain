import { CheckEventSanctionsHandler } from '../../../../../src/application/use-cases/event/check-event-sanctions/check-event-sanctions.handler.js';
import { CheckEventSanctionsCommand } from '../../../../../src/application/use-cases/event/check-event-sanctions/check-event-sanctions.command.js';
import { PRESEASON_EVENT_ID } from '../../../../../src/domain/prize/event-settlement.js';
import { LocalSanctionsCheckAdapter } from '../../../../../src/infrastructure/prize/local-sanctions-check.adapter.js';
import { testAdmin } from '../../../../support/admin-fixtures.js';
import { eventUnit } from '../../../../support/event-fixtures.js';
import { unitContext } from '../../../../support/unit-context.js';

const setup = async () => {
  const ctx = unitContext(), ev = eventUnit(ctx), admin = testAdmin(ctx);
  await ev.schedule(); await ev.rideOf('a', 9000);
  const check = new LocalSanctionsCheckAdapter();
  return { ctx, ev, admin, check, handler: new CheckEventSanctionsHandler(ev.view, ev.repo, check, ctx.proofs, ctx.adminActions, ctx.transactions, ctx.clock) };
};

describe('CheckEventSanctionsHandler', () => {
  it('records the port result with its time, keeps the flags and audits it', async () => {
    const { ctx, ev, admin, handler } = await setup();
    await ev.repo.saveReview(PRESEASON_EVENT_ID, { wallet: 'a', disqualified: false, prizeEligibleOverride: false, note: 'n', sanctionsCheckedAt: null, sanctionsClean: null, sanctionsRef: null, updatedBy: 'x', updatedAt: ctx.now() }, undefined as never);
    const saved = await handler.execute(new CheckEventSanctionsCommand(admin.wallet, 'a', 'req', await admin.sign({ action: 'event_sanctions', wallet: 'a' })));
    expect(saved).toMatchObject({ sanctionsClean: true, sanctionsRef: 'local-fake-v1', sanctionsCheckedAt: ctx.now(), prizeEligibleOverride: false, note: 'n' });
    expect(ctx.db.adminActions[0]).toMatchObject({ action: 'event.sanctions', target: 'a', detail: { clean: true } });
  });

  it('a listed wallet is recorded as not clean', async () => {
    const { ctx, admin, handler, check } = await setup();
    vi.spyOn(check, 'check').mockResolvedValue({ clean: false, ref: 'listed' });
    await ctx.player('b');
    const saved = await handler.execute(new CheckEventSanctionsCommand(admin.wallet, 'a', null, await admin.sign({ action: 'event_sanctions', wallet: 'a' })));
    expect(saved.sanctionsClean).toBe(false);
  });

  it('only candidates before the lock and only winners after it; a wrong signature is a 401', async () => {
    const { ctx, ev, admin, handler } = await setup();
    await expect(handler.execute(new CheckEventSanctionsCommand(admin.wallet, 'ghost', null, await admin.sign({ action: 'event_sanctions', wallet: 'ghost' })))).rejects.toMatchObject({ errorCode: 'event_candidate_not_found' });
    await expect(handler.execute(new CheckEventSanctionsCommand(admin.wallet, 'a', null, await admin.sign({ action: 'event_sanctions', wallet: 'ghost' })))).rejects.toMatchObject({ statusCode: 401 });
    await ev.repo.lock(PRESEASON_EVENT_ID, 'adm', ctx.now(), [], undefined as never);   // locked with no winners: the candidate is no longer checkable
    await expect(handler.execute(new CheckEventSanctionsCommand(admin.wallet, 'a', null, await admin.sign({ action: 'event_sanctions', wallet: 'a' })))).rejects.toMatchObject({ errorCode: 'event_candidate_not_found' });
  });
});
