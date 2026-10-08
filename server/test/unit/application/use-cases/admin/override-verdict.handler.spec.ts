import { OverrideVerdictHandler } from '../../../../../src/application/use-cases/admin/override-verdict/override-verdict.handler.js';
import { OverrideVerdictCommand } from '../../../../../src/application/use-cases/admin/override-verdict/override-verdict.command.js';
import { RideBatch } from '../../../../../src/domain/telemetry/ride-batch.entity.js';
import { NotFoundError, UnauthorizedError } from '../../../../../src/domain/shared/errors.js';
import { VerdictStatus } from '../../../../../src/domain/verdict/verdict.dto.js';
import { judgedRide, testAdmin } from '../../../../support/admin-fixtures.js';
import { hashBatch, recording } from '../../../../support/recording.js';
import { unitContext } from '../../../../support/unit-context.js';

describe('OverrideVerdictHandler', () => {
  it('accepts a flagged ride, signed for exactly this decision: verified by hand, reasons kept, audited with the request id and the signed text', async () => {
    const ctx = unitContext(), admin = testAdmin(ctx);
    const { ride } = await judgedRide(ctx, 'bob', { inputs: 'bot', seconds: 180 }, 180, 2400);
    const signature = await admin.sign({ action: 'override', rideId: ride.id, decision: 'verified', note: 'watched it – a person' });
    const dto = await new OverrideVerdictHandler(ctx.verdicts, ctx.proofs).execute(new OverrideVerdictCommand(admin.wallet, ride.id, VerdictStatus.Verified, 'watched it – a person', 'req-42', signature));
    expect(dto).toMatchObject({ status: 'verified', override: { by: admin.wallet, at: ctx.clock.ms, note: 'watched it – a person' } });
    expect(dto.reasons.map((r) => r.code)).toContain('uniform-holds');
    expect((await ctx.verdictRepo.findByRide(ride.id))?.status).toBe(VerdictStatus.Verified);
    const [row] = ctx.db.adminActions;
    expect(row).toMatchObject({ wallet: admin.wallet, action: 'verdict.override', target: ride.id, detail: { from: 'flagged', to: 'verified', note: 'watched it – a person', rider: 'bob', signed: { signature } }, requestId: 'req-42', at: ctx.now() });
    expect((row?.detail['signed'] as { message: string }).message).toContain(`Ride: ${ride.id}`);
  });

  it('no change without the right signature: another decision, another note, another ride, a replay, a forged key → 401, nothing changed or audited', async () => {
    const ctx = unitContext(), admin = testAdmin(ctx);
    const { ride } = await judgedRide(ctx, 'bob', { inputs: 'bot', seconds: 180 }, 180, 2400);
    const h = new OverrideVerdictHandler(ctx.verdicts, ctx.proofs);
    const run = (decision: VerdictStatus.Verified | VerdictStatus.Rejected, note: string | null, signature: string, rideId = ride.id) => h.execute(new OverrideVerdictCommand(admin.wallet, rideId, decision, note, null, signature));
    await expect(run(VerdictStatus.Verified, null, await admin.sign({ action: 'override', rideId: ride.id, decision: 'rejected', note: null }))).rejects.toThrow(/another change/);
    await expect(run(VerdictStatus.Verified, 'ok', await admin.sign({ action: 'override', rideId: ride.id, decision: 'verified', note: 'ok!' }))).rejects.toThrow(/another change/);
    await expect(run(VerdictStatus.Verified, null, await admin.sign({ action: 'rejudge', rideId: ride.id }))).rejects.toThrow(/another change/);
    const message = await ctx.proofs.issue(admin.wallet, { action: 'override', rideId: ride.id, decision: 'verified', note: null });
    await expect(run(VerdictStatus.Verified, null, admin.signText(message, testAdmin(ctx).kp))).rejects.toThrow(/bad signature/);
    await expect(run(VerdictStatus.Verified, null, admin.signText(message))).rejects.toThrow(/no signed request/);   // consumed by the failed try: a replay is refused too
    await expect(run(VerdictStatus.Verified, null, 'garbage')).rejects.toBeInstanceOf(UnauthorizedError);
    expect((await ctx.verdictRepo.findByRide(ride.id))?.status).toBe(VerdictStatus.Flagged);
    expect(ctx.db.adminActions).toEqual([]);
  });

  it('a later re-judge (a late batch) leaves the decision alone', async () => {
    const ctx = unitContext(), admin = testAdmin(ctx);
    const { ride } = await judgedRide(ctx, 'bob', null); // rejected: no recording
    const signature = await admin.sign({ action: 'override', rideId: ride.id, decision: 'verified', note: null });
    await new OverrideVerdictHandler(ctx.verdicts, ctx.proofs).execute(new OverrideVerdictCommand(admin.wallet, ride.id, VerdictStatus.Verified, null, null, signature));
    for (const b of recording(ride.id, { seconds: 10, distance: 5 })) await ctx.batches.insert(RideBatch.accept(ride.id, b, hashBatch(b), ctx.now()));
    expect((await ctx.verdicts.judge(ride.id))?.toDto()).toMatchObject({ status: 'verified', override: { by: admin.wallet } });
  });

  it('an unknown ride or a ride without a verdict is a 404 (after a valid signature)', async () => {
    const ctx = unitContext(), admin = testAdmin(ctx);
    const h = new OverrideVerdictHandler(ctx.verdicts, ctx.proofs);
    const signed = async (rideId: string) => admin.sign({ action: 'override', rideId, decision: 'rejected', note: null });
    await expect(h.execute(new OverrideVerdictCommand(admin.wallet, 'nope', VerdictStatus.Rejected, null, null, await signed('nope')))).rejects.toBeInstanceOf(NotFoundError);
    const running = await ctx.freeRide('w', true);
    await expect(h.execute(new OverrideVerdictCommand(admin.wallet, running.id, VerdictStatus.Rejected, null, null, await signed(running.id)))).rejects.toThrow(/no verdict/);
    expect(ctx.db.adminActions).toEqual([]);
  });
});
