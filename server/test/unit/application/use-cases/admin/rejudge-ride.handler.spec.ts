import { RejudgeRideHandler } from '../../../../../src/application/use-cases/admin/rejudge-ride/rejudge-ride.handler.js';
import { RejudgeRideCommand } from '../../../../../src/application/use-cases/admin/rejudge-ride/rejudge-ride.command.js';
import { OverrideVerdictHandler } from '../../../../../src/application/use-cases/admin/override-verdict/override-verdict.handler.js';
import { OverrideVerdictCommand } from '../../../../../src/application/use-cases/admin/override-verdict/override-verdict.command.js';
import { NotFoundError } from '../../../../../src/domain/shared/errors.js';
import { VerdictStatus } from '../../../../../src/domain/verdict/verdict.dto.js';
import { judgedRide } from '../../../../support/admin-fixtures.js';
import { unitContext } from '../../../../support/unit-context.js';

describe('RejudgeRideHandler', () => {
  it('runs the checks again – even over an admin decision – and audits it', async () => {
    const ctx = unitContext();
    const { ride } = await judgedRide(ctx, 'bob', { inputs: 'bot', seconds: 180 }, 180, 2400);
    await new OverrideVerdictHandler(ctx.verdicts).execute(new OverrideVerdictCommand('ADMIN', ride.id, VerdictStatus.Verified, null, null));
    const dto = await new RejudgeRideHandler(ctx.verdicts).execute(new RejudgeRideCommand('ADMIN', ride.id, 'req-7'));
    expect(dto).toMatchObject({ status: 'flagged', override: null });
    expect(ctx.db.adminActions.at(-1)).toMatchObject({ action: 'verdict.rejudge', target: ride.id, detail: { from: 'verified', to: 'flagged' }, requestId: 'req-7' });
  });

  it('judges a completed shift that was never judged (judging failed after /end); a ride that is not a completed shift is a 404', async () => {
    const ctx = unitContext();
    const { ride } = await judgedRide(ctx, 'alice');
    ctx.db.verdicts.clear(); // the judgement after /end failed
    expect((await new RejudgeRideHandler(ctx.verdicts).execute(new RejudgeRideCommand('ADMIN', ride.id, null))).status).toBe('verified');
    const running = await ctx.freeRide('w', true);
    await expect(new RejudgeRideHandler(ctx.verdicts).execute(new RejudgeRideCommand('ADMIN', running.id, null))).rejects.toBeInstanceOf(NotFoundError);
  });

  it('after the retention sweep deleted the recording, RE-JUDGE refuses (409) and the verdict stays', async () => {
    const ctx = unitContext();
    const { ride } = await judgedRide(ctx, 'alice');
    ctx.db.batches.clear(); // swept
    await expect(new RejudgeRideHandler(ctx.verdicts).execute(new RejudgeRideCommand('ADMIN', ride.id, null))).rejects.toThrow(/deleted by the retention sweep/);
    expect((await ctx.verdictRepo.findByRide(ride.id))?.status).toBe('verified');
    expect(ctx.db.adminActions).toEqual([]);
  });

  it('an override of a completed shift without a verdict judges it first, then decides', async () => {
    const ctx = unitContext();
    const { ride } = await judgedRide(ctx, 'alice');
    ctx.db.verdicts.clear();
    const dto = await new OverrideVerdictHandler(ctx.verdicts).execute(new OverrideVerdictCommand('ADMIN', ride.id, VerdictStatus.Rejected, 'fake', null));
    expect(dto).toMatchObject({ status: 'rejected', override: { by: 'ADMIN', note: 'fake' } });
  });
});
