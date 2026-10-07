import { RejudgeRideHandler } from '../../../../../src/application/use-cases/admin/rejudge-ride/rejudge-ride.handler.js';
import { RejudgeRideCommand } from '../../../../../src/application/use-cases/admin/rejudge-ride/rejudge-ride.command.js';
import { OverrideVerdictHandler } from '../../../../../src/application/use-cases/admin/override-verdict/override-verdict.handler.js';
import { OverrideVerdictCommand } from '../../../../../src/application/use-cases/admin/override-verdict/override-verdict.command.js';
import { NotFoundError } from '../../../../../src/domain/shared/errors.js';
import { VerdictStatus } from '../../../../../src/domain/verdict/verdict.dto.js';
import { judgedRide, testAdmin } from '../../../../support/admin-fixtures.js';
import { unitContext } from '../../../../support/unit-context.js';

describe('RejudgeRideHandler', () => {
  it('runs the checks again – even over an admin decision – and audits it with the signed text', async () => {
    const ctx = unitContext(), admin = testAdmin(ctx);
    const { ride } = await judgedRide(ctx, 'bob', { inputs: 'bot', seconds: 180 }, 180, 2400);
    const accept = await admin.sign({ action: 'override', rideId: ride.id, decision: 'verified', note: null });
    await new OverrideVerdictHandler(ctx.verdicts, ctx.proofs).execute(new OverrideVerdictCommand(admin.wallet, ride.id, VerdictStatus.Verified, null, null, accept));
    const signature = await admin.sign({ action: 'rejudge', rideId: ride.id });
    const dto = await new RejudgeRideHandler(ctx.verdicts, ctx.proofs).execute(new RejudgeRideCommand(admin.wallet, ride.id, 'req-7', signature));
    expect(dto).toMatchObject({ status: 'flagged', override: null });
    expect(ctx.db.adminActions.at(-1)).toMatchObject({ action: 'verdict.rejudge', target: ride.id, detail: { from: 'verified', to: 'flagged', signed: { signature } }, requestId: 'req-7' });
  });

  it('a signature for another ride (or for an override) re-judges nothing (401)', async () => {
    const ctx = unitContext(), admin = testAdmin(ctx);
    const { ride } = await judgedRide(ctx, 'bob');
    const h = new RejudgeRideHandler(ctx.verdicts, ctx.proofs);
    await expect(h.execute(new RejudgeRideCommand(admin.wallet, ride.id, null, await admin.sign({ action: 'rejudge', rideId: 'another' })))).rejects.toThrow(/another change/);
    await expect(h.execute(new RejudgeRideCommand(admin.wallet, ride.id, null, await admin.sign({ action: 'override', rideId: ride.id, decision: 'rejected', note: null })))).rejects.toThrow(/another change/);
    expect(ctx.db.adminActions).toEqual([]);
  });

  it('judges a completed shift that was never judged (judging failed after /end); a ride that is not a completed shift is a 404', async () => {
    const ctx = unitContext(), admin = testAdmin(ctx);
    const { ride } = await judgedRide(ctx, 'alice');
    ctx.db.verdicts.clear(); // the judgement after /end failed
    const h = new RejudgeRideHandler(ctx.verdicts, ctx.proofs);
    expect((await h.execute(new RejudgeRideCommand(admin.wallet, ride.id, null, await admin.sign({ action: 'rejudge', rideId: ride.id })))).status).toBe('verified');
    const running = await ctx.freeRide('w', true);
    await expect(h.execute(new RejudgeRideCommand(admin.wallet, running.id, null, await admin.sign({ action: 'rejudge', rideId: running.id })))).rejects.toBeInstanceOf(NotFoundError);
  });

  it('after the retention sweep deleted the recording, RE-JUDGE refuses (409) and the verdict stays', async () => {
    const ctx = unitContext(), admin = testAdmin(ctx);
    const { ride } = await judgedRide(ctx, 'alice');
    ctx.db.batches.clear(); // swept
    await expect(new RejudgeRideHandler(ctx.verdicts, ctx.proofs).execute(new RejudgeRideCommand(admin.wallet, ride.id, null, await admin.sign({ action: 'rejudge', rideId: ride.id })))).rejects.toThrow(/deleted by the retention sweep/);
    expect((await ctx.verdictRepo.findByRide(ride.id))?.status).toBe('verified');
    expect(ctx.db.adminActions).toEqual([]);
  });

  it('an override of a completed shift without a verdict judges it first, then decides', async () => {
    const ctx = unitContext(), admin = testAdmin(ctx);
    const { ride } = await judgedRide(ctx, 'alice');
    ctx.db.verdicts.clear();
    const signature = await admin.sign({ action: 'override', rideId: ride.id, decision: 'rejected', note: 'fake' });
    const dto = await new OverrideVerdictHandler(ctx.verdicts, ctx.proofs).execute(new OverrideVerdictCommand(admin.wallet, ride.id, VerdictStatus.Rejected, 'fake', null, signature));
    expect(dto).toMatchObject({ status: 'rejected', override: { by: admin.wallet, note: 'fake' } });
  });
});
