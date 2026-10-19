import { RoadPlan } from '../../../src/domain/road/road-plan.js';
import { summariseBatch } from '../../../src/domain/telemetry/batch-summary.js';
import { RideBatch, type BatchBody } from '../../../src/domain/telemetry/ride-batch.entity.js';
import { unsafeSamples } from '../../../src/domain/telemetry/sample-safety.js';

const row = (t: number, s: number): number[] => [t, s, 2.4, 0, 28, 1800, 7, 100, 1, 0, 0, 0];
const now = new Date('2026-10-15T12:00:00Z');
const body = (samples: number[][], t1 = 15): BatchBody => ({ seq: 0, prevHash: 'ride', hash: null, t0: 0, t1, samples, inputs: [] });

describe('telemetry road work safety', () => {
  it.each([
    [row(0, 0), row(0.1, 1e12)],
    [row(0, 0), row(0.1, 1e7)],
    [row(0, 0), row(0.1, -1e7)],
    [row(1e7, 1e7)], // a future sample inside a short batch
    [[0, 0]],
    [[0, 0, 2.4, NaN, 0, 900, 1, 100, 0, 0, 0, 0]],
    Array.from({ length: 30 }, (_, i) => row(i / 10, i % 2 ? 900 : 0)), // short individual jumps, excessive total work
  ])('refuses malformed uploads and summaries before any geometry (%#)', (...samples: number[][]) => {
    const plan = RoadPlan.forSeed(7, null);
    const holes = vi.spyOn(plan, 'holesNear').mockImplementation(() => { throw new Error('unsafe geometry'); });
    const road = vi.spyOn(plan.layout, 'onRoad').mockImplementation(() => { throw new Error('unsafe geometry'); });
    const fork = vi.spyOn(plan.layout, 'forkSwitch').mockImplementation(() => { throw new Error('unsafe geometry'); });
    expect(() => RideBatch.accept('ride', body(samples), 'hash', now, undefined, undefined, 0, plan)).toThrow(/sample|road work/);
    expect(summariseBatch(0, 0, 15, samples, [], plan)).toMatchObject({ world: null, fault: { code: 'bad-sample' } });
    expect(holes).not.toHaveBeenCalled();
    expect(road).not.toHaveBeenCalled();
    expect(fork).not.toHaveBeenCalled();
  });

  it('checks jumps across the batch boundary and an unsafe stored tail', () => {
    const previous = [row(1000, 10_000)], next = [row(1000.1, 20_000)];
    expect(unsafeSamples(1, 1001, next)).toBeNull();
    expect(unsafeSamples(1, 1001, next, previous)).toMatch(/road work/);
    expect(() => RideBatch.accept('ride', body(next, 1001), 'hash', now, undefined, undefined, 0, null, previous)).toThrow(/road work/);
    expect(summariseBatch(1, 1000, 1001, next, [], null, previous).fault?.code).toBe('bad-sample');
    expect(unsafeSamples(1, 1001, next, [row(1000, 1e12)])).toMatch(/out of range/);
  });

  it('allows a full batch at the governor after eight hours, with the previous batch tail', () => {
    const samples = Array.from({ length: 400 }, (_, i) => row(28800 + i / 10, (28800 + i / 10) * 28));
    const prefix = Array.from({ length: 400 }, (_, i) => row(28760 + i / 10, (28760 + i / 10) * 28));
    expect(unsafeSamples(0, 28840, samples, prefix)).toBeNull();
    expect(RideBatch.accept('ride', body(samples, 28840), 'hash', now, undefined, undefined, 0, null, prefix).summary.fault).toBeNull();
  });
});
