import { OverrideVerdictHandler } from '../../../../../src/application/use-cases/admin/override-verdict/override-verdict.handler.js';
import { OverrideVerdictCommand } from '../../../../../src/application/use-cases/admin/override-verdict/override-verdict.command.js';
import { RideBatch } from '../../../../../src/domain/telemetry/ride-batch.entity.js';
import { NotFoundError } from '../../../../../src/domain/shared/errors.js';
import { VerdictStatus } from '../../../../../src/domain/verdict/verdict.dto.js';
import { judgedRide } from '../../../../support/admin-fixtures.js';
import { hashBatch, recording } from '../../../../support/recording.js';
import { unitContext } from '../../../../support/unit-context.js';

describe('OverrideVerdictHandler', () => {
  it('accepts a flagged ride: verified by hand, reasons kept, audited with the request id', async () => {
    const ctx = unitContext();
    const { ride } = await judgedRide(ctx, 'bob', { inputs: 'bot', seconds: 180 }, 180, 2400);
    const dto = await new OverrideVerdictHandler(ctx.verdicts).execute(new OverrideVerdictCommand('ADMIN', ride.id, VerdictStatus.Verified, 'watched it – a person', 'req-42'));
    expect(dto).toMatchObject({ status: 'verified', override: { by: 'ADMIN', at: ctx.clock.ms, note: 'watched it – a person' } });
    expect(dto.reasons.map((r) => r.code)).toContain('uniform-holds');
    expect((await ctx.verdictRepo.findByRide(ride.id))?.status).toBe(VerdictStatus.Verified);
    expect(ctx.db.adminActions).toEqual([{ wallet: 'ADMIN', action: 'verdict.override', target: ride.id, detail: { from: 'flagged', to: 'verified', note: 'watched it – a person', rider: 'bob' }, requestId: 'req-42', at: ctx.now() }]);
  });

  it('a later re-judge (a late batch) leaves the decision alone', async () => {
    const ctx = unitContext();
    const { ride } = await judgedRide(ctx, 'bob', null); // rejected: no recording
    await new OverrideVerdictHandler(ctx.verdicts).execute(new OverrideVerdictCommand('ADMIN', ride.id, VerdictStatus.Verified, null, null));
    for (const b of recording(ride.id, { seconds: 10, distance: 5 })) await ctx.batches.insert(RideBatch.accept(ride.id, b, hashBatch(b), ctx.now()));
    expect((await ctx.verdicts.judge(ride.id))?.toDto()).toMatchObject({ status: 'verified', override: { by: 'ADMIN' } });
  });

  it('an unknown ride or a ride without a verdict is a 404', async () => {
    const ctx = unitContext();
    const h = new OverrideVerdictHandler(ctx.verdicts);
    await expect(h.execute(new OverrideVerdictCommand('ADMIN', 'nope', VerdictStatus.Rejected, null, null))).rejects.toBeInstanceOf(NotFoundError);
    const running = await ctx.freeRide('w', true);
    await expect(h.execute(new OverrideVerdictCommand('ADMIN', running.id, VerdictStatus.Rejected, null, null))).rejects.toThrow(/no verdict/);
    expect(ctx.db.adminActions).toEqual([]);
  });
});
