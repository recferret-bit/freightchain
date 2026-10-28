import { GetEventBoardHandler } from '../../../../../src/application/use-cases/event/get-event-board/get-event-board.handler.js';
import { PRESEASON_EVENT_ID } from '../../../../../src/domain/prize/event-settlement.js';
import { RideVerdict } from '../../../../../src/domain/verdict/ride-verdict.entity.js';
import { VerdictStatus } from '../../../../../src/domain/verdict/verdict.dto.js';
import { eventUnit } from '../../../../support/event-fixtures.js';
import { unitContext } from '../../../../support/unit-context.js';

const WALLET = 'Abcd1111111111111111111111111111111111Wxyz';

describe('GetEventBoardHandler', () => {
  it('is empty before the review end, then preliminary with shortened wallets and no transaction links', async () => {
    const ctx = unitContext(), ev = eventUnit(ctx), handler = new GetEventBoardHandler(ev.view);
    await ev.schedule(); await ev.rideOf(WALLET, 9000); await ev.rideOf('ru', 9500, { country: 'BY' });
    expect(await handler.execute()).toMatchObject({ phase: 'pending', rows: [] });
    ctx.clock.advance(1001);
    const pre = await handler.execute();
    expect(pre.rows).toEqual([
      { rank: 1, place: null, wallet: 'ru', bps: 9500, amountCents: 0, prizeEligible: false, txSignature: null, solscanUrl: null },
      { rank: 2, place: 1, wallet: 'Abcd…Wxyz', bps: 9000, amountCents: 10000, prizeEligible: true, txSignature: null, solscanUrl: null },
    ]);
  });

  it('is final from the locked list, with the Solscan link of a recorded payout only', async () => {
    const ctx = unitContext(), ev = eventUnit(ctx), handler = new GetEventBoardHandler(ev.view);
    await ev.schedule(); await ev.rideOf('a', 9000); await ev.rideOf('b', 8000);
    ctx.clock.advance(2001);
    const w = (wallet: string, place: number, tx: string | null) => ({ wallet, place, amountCents: 1000, bps: 9000, rideId: 'r', lockedAt: ctx.now(), txSignature: tx, paidAt: tx ? ctx.now() : null, recordedBy: tx ? 'adm' : null });
    await ev.repo.lock(PRESEASON_EVENT_ID, 'adm', ctx.now(), [w('a', 1, 'sigA'), w('b', 2, null)], undefined as never);
    const fin = await handler.execute();
    expect(fin.phase).toBe('final');
    expect(fin.rows.map((r) => [r.wallet, r.solscanUrl])).toEqual([['a', 'https://solscan.io/tx/sigA'], ['b', null]]);
  });

  it('the final table is the frozen list: a later rejected verdict or a zeroed event window does not remove a winner or his link', async () => {
    const ctx = unitContext(), ev = eventUnit(ctx), handler = new GetEventBoardHandler(ev.view);
    await ev.schedule(); const rideId = await ev.rideOf('a', 9000);
    ctx.clock.advance(2001);
    await ev.repo.lock(PRESEASON_EVENT_ID, 'adm', ctx.now(), [{ wallet: 'a', place: 1, amountCents: 10000, bps: 9000, rideId, lockedAt: ctx.now(), txSignature: 'sigA', paidAt: ctx.now(), recordedBy: 'adm' }], undefined as never);
    await ctx.verdictRepo.save(RideVerdict.restore({ rideId, status: VerdictStatus.Rejected, reasons: [], scores: {} as never, rulesVersion: 4, judgedAt: ctx.now(), version: 2 }));   // an admin re-judge after the lock
    await ctx.settingsRepo.upsert('event_week_start_utc', 0);   // the next round reuses the event keys
    const fin = await handler.execute();
    expect(fin.rows).toEqual([{ rank: 1, place: 1, wallet: 'a', bps: 9000, amountCents: 10000, prizeEligible: true, txSignature: 'sigA', solscanUrl: 'https://solscan.io/tx/sigA' }]);
  });

  it('stays hidden when the schedule is incomplete even long after the event', async () => {
    const ctx = unitContext(), ev = eventUnit(ctx), handler = new GetEventBoardHandler(ev.view);
    await ev.schedule(); await ev.rideOf('a', 9000);
    await ctx.settingsRepo.upsert('event_appeals_end_utc', 0);
    ctx.clock.advance(100_000);
    expect(await handler.execute()).toMatchObject({ phase: 'pending', rows: [] });
  });
});
