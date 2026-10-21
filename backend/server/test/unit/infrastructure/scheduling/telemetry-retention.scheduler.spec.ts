import { Logger } from '@nestjs/common';
import { afterEach, beforeEach, vi } from 'vitest';
import { SweepTelemetryCommand } from '../../../../src/application/use-cases/telemetry/sweep-telemetry/sweep-telemetry.command.js';
import { RideVerdict } from '../../../../src/domain/verdict/ride-verdict.entity.js';
import { VerdictStatus } from '../../../../src/domain/verdict/verdict.dto.js';
import { SweepSignInsCommand } from '../../../../src/application/use-cases/auth/sweep-sign-ins/sweep-sign-ins.command.js';
import { TelemetryRetentionScheduler } from '../../../../src/infrastructure/scheduling/telemetry-retention.scheduler.js';
import { busMock } from '../../../support/bus.js';
import { FakeClock } from '../../../support/fake-clock.js';

/** The fake clock starts 2036-10-08 12:00 UTC: the next 00:30 UTC is 12.5 h away. */
describe('TelemetryRetentionScheduler', () => {
  let clock: FakeClock;
  const HOUR = 3_600_000;
  const tick = async (ms: number) => { clock.ms += ms; await vi.advanceTimersByTimeAsync(ms); };
  beforeEach(() => { vi.useFakeTimers(); clock = new FakeClock(); });
  afterEach(() => vi.useRealTimers());

  it('sweeps on boot, then every day at 00:30 UTC', async () => {
    const { bus, sent } = busMock({ cutoff: 1, deleted: 3 });
    const scheduler = new TelemetryRetentionScheduler(bus as never, clock);
    scheduler.onApplicationBootstrap();
    await vi.advanceTimersByTimeAsync(0);
    expect(sent).toHaveLength(2); // the recording sweep, then the sign-in sweep
    expect(sent[0]).toBeInstanceOf(SweepTelemetryCommand);
    expect(sent[1]).toBeInstanceOf(SweepSignInsCommand);
    await tick(12 * HOUR);
    expect(sent).toHaveLength(2); // 00:00 – not yet
    await tick(HOUR / 2 + 1);
    expect(sent).toHaveLength(4); // 00:30
    await tick(24 * HOUR);
    expect(sent).toHaveLength(6);
    scheduler.onApplicationShutdown();
  });

  it('retries a failed sweep in 10 minutes; stops on shutdown', async () => {
    let calls = 0;
    const bus = { execute: async () => { if (++calls === 1) throw new Error('db down'); return { cutoff: null, deleted: 0 }; } };
    const scheduler = new TelemetryRetentionScheduler(bus as never, clock);
    scheduler.onApplicationBootstrap();
    await vi.advanceTimersByTimeAsync(0);
    await tick(10 * 60_000 + 1);
    expect(calls).toBe(3); // the retry runs both sweeps
    scheduler.onApplicationShutdown();
    await tick(48 * HOUR);
    expect(calls).toBe(3);
  });

  it('nulls raw inp only after payout and 90 days, and alerts a similar pair, from the daily job', async () => {
    const now = clock.now();
    const nulled: string[] = [];
    const batches = {
      inpRetentionRows: () => Promise.resolve([
        { rideId: 'old', inpAt: new Date(now.getTime() - 91 * 86_400_000), payoutFinalizedAt: new Date(now.getTime() - 1000) },
        { rideId: 'young', inpAt: now, payoutFinalizedAt: new Date(now.getTime() - 1000) },
        { rideId: 'unpaid', inpAt: new Date(now.getTime() - 91 * 86_400_000), payoutFinalizedAt: null },
      ]),
      nullInp: (rows: readonly { rideId: string }[]) => { nulled.push(...rows.map((row) => row.rideId)); return Promise.resolve(rows.length); },
      validationTraces: () => Promise.resolve([
        { rideId: 'a', wallet: 'a', intervalsMs: Array.from({ length: 60 }, () => 100) },
        { rideId: 'b', wallet: 'b', intervalsMs: Array.from({ length: 60 }, () => 100) },
      ]),
    };
    const scores = { recording: { batches: 1, samples: 0, inputs: 0, recordedSeconds: 0, coverage: 0, maxSpeed: 0, unhashed: 0 }, human: { presses: 0, minHoldCv: null, repeatShare: null, instantShare: null, timerStepMs: 0 }, challenges: { issued: 0, answered: 0, missed: 0, tooFast: 0, medianReactionMs: null } };
    const stored = new Map<string, RideVerdict>();
    for (const rideId of ['a', 'b']) stored.set(rideId, RideVerdict.restore({ rideId, status: VerdictStatus.Verified, reasons: [], rulesVersion: 1, judgedAt: now, version: 1, scores }));
    const verdicts = {
      findByRide: (rideId: string) => Promise.resolve(stored.get(rideId) ?? null),
      save: (verdict: RideVerdict) => { stored.set(verdict.rideId, verdict); return Promise.resolve(); },
    };
    const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const { bus, sent } = busMock({ cutoff: null, deleted: 0 });
    const scheduler = new TelemetryRetentionScheduler(bus as never, clock, undefined, batches as never, verdicts as never);
    scheduler.onApplicationBootstrap();
    await vi.advanceTimersByTimeAsync(0);
    expect(sent[0]).toEqual(new SweepTelemetryCommand(true));
    expect(nulled).toEqual(['old']);
    expect(warn).toHaveBeenCalledWith(expect.objectContaining({ code: 'trace-cluster' }));
    expect(stored.get('a')?.status).toBe(VerdictStatus.Flagged);
    expect(stored.get('b')?.reasons.some((reason) => reason.code === 'trace-cluster')).toBe(true);
    scheduler.onApplicationShutdown();
    warn.mockRestore();
  });
});
