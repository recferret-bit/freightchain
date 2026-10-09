import { parseSummary, SUMMARY_VERSION, summariseBatch } from '../../../src/domain/telemetry/batch-summary.js';
import type { InputEvent } from '../../../src/domain/telemetry/ride-batch.entity.js';

/* The per-batch summary judging reads instead of the samples: measurements only, no decisions. */
const row = (t: number, s: number, v: number) => [t, s, 2.4, 0, v, 1200, 5, 100, 0.6, 0, 0, 0];
const inputs: InputEvent[] = [[100, 'KeyW', 1], [900, 'KeyW', 0]];

describe('summariseBatch', () => {
  it('counts, first / last sample, max speed, the worst step over the governor, the input events', () => {
    const s = summariseBatch(3, 45, 60, [row(45, 600, 10), row(45.1, 601.2, 12), row(45.2, 603.9, 27), row(45.3, 605, 11)], inputs);
    expect(s).toMatchObject({ v: SUMMARY_VERSION, samples: 4, first: [45, 600], last: [45.3, 605], maxSpeed: 27, fault: null, inputs });
    expect(s.worstStep).toEqual({ ds: 2.7, dt: 0.1, t: 45.2, over: -0.1 }); // 2.7 m in 0.1 s is 0.1 m UNDER 28 m/s × 0.1 s
    expect(s.inputs).not.toBe(inputs); // its own copy
  });

  it('a teleport shows as a step far over the governor; the one with the largest excess wins', () => {
    const s = summariseBatch(0, 0, 2, [row(0, 0, 10), row(0.1, 50, 10), row(0.2, 51, 10), row(0.3, 900, 10)], []);
    expect(s.worstStep).toEqual({ ds: 849, dt: 0.1, t: 0.3, over: 846.2 });
  });

  it('a short row is a bad-sample fault and stops the measuring there; a sample outside its batch or out of order is sample-out-of-order', () => {
    expect(summariseBatch(1, 15, 30, [row(15, 200, 10), [16, 210, 2.4], row(16.1, 211, 10)], []).fault).toEqual({ code: 'bad-sample', detail: 'a sample in batch 1 has 3 values' });
    expect(summariseBatch(1, 15, 30, [row(15, 200, 10), row(14, 190, 10)], [])).toMatchObject({ fault: { code: 'sample-out-of-order', detail: 'sample at t=14 s is outside batch 1 or out of order' }, samples: 2, last: [15, 200] });
    expect(summariseBatch(1, 15, 30, [row(31, 200, 10)], []).fault?.code).toBe('sample-out-of-order');
    expect(summariseBatch(1, 15, 30, [row(15.04, 200, 10), row(30.04, 210, 10)], []).fault).toBeNull(); // rounding slack
  });

  it('an empty batch has no samples and nothing to measure', () => {
    expect(summariseBatch(0, 0, 0, [], [])).toEqual({ v: SUMMARY_VERSION, samples: 0, first: null, last: null, maxSpeed: 0, worstStep: null, fault: null, inputs: [], world: null });
  });

  it('parseSummary takes back a stored summary and refuses junk or another version', () => {
    const s = summariseBatch(0, 0, 1, [row(0, 0, 1), row(0.1, 0.1, 1)], inputs);
    expect(parseSummary(JSON.parse(JSON.stringify(s)))).toEqual(s);
    expect(parseSummary({ ...s, v: SUMMARY_VERSION + 1 })).toBeNull();
    expect(parseSummary(null)).toBeNull();
    expect(parseSummary('x')).toBeNull();
    expect(parseSummary({ v: SUMMARY_VERSION })).toBeNull();
  });
});
