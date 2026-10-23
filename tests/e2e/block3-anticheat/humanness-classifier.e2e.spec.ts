import { describe, expect, it } from 'vitest';
import { classifyHumanness, intervalsMs, type HumannessInput, type InpEvent } from '../../../backend/server/src/domain/anticheat/humanness.js';

const FRAME_US = 16667;

function offGrid(tUs: number): number {
  return tUs % FRAME_US === 0 ? tUs + 3 : tUs;
}

function eventsFromGaps(gapsMs: readonly number[], steerAt: number): InpEvent[] {
  let tUs = 2500;
  return gapsMs.map((gap, i) => {
    tUs = offGrid(tUs + gap * 1000);
    return { tUs, code: i === steerAt ? 'steer' : 'gas', down: true, trusted: true };
  });
}

function humanInput(gapsMs: readonly number[], rtMs: readonly number[]): HumannessInput {
  return {
    events: eventsFromGaps(gapsMs, 3),
    stimuli: rtMs.map((rt, i) => ({ visibleAtUs: i * 1_000_000, respondedAtUs: i * 1_000_000 + rt * 1000 })),
    holdsMs: [90, 160, 240, 410],
  };
}

const HUMAN_GAPS = [180, 95, 420, 140, 760, 210, 330, 110, 890, 260, 540, 150];
const DROWSY_GAPS = [400, 220, 900, 350, 1400, 480, 700, 260, 1800, 550, 1100, 640];

describe('humanness classifier', () => {
  it('AC-H1 bot-quantized identical holds are rejected physically-impossible-holds', () => {
    const result = classifyHumanness({ events: [], holdsMs: Array.from({ length: 50 }, () => 200) });
    expect(result.verdict).toBe('rejected');
    expect(result.reasons).toContain('physically-impossible-holds');
  });

  it('AC-H1 bot-quantized frame grid is rejected physically-impossible-frame-grid', () => {
    const events = Array.from({ length: 10 }, (_, i) => ({ tUs: i * FRAME_US, code: 'gas', down: true, trusted: true }));
    expect(events.every((event) => event.tUs % FRAME_US === 0)).toBe(true);
    const result = classifyHumanness({ events });
    expect(result.verdict).toBe('rejected');
    expect(result.reasons).toContain('physically-impossible-frame-grid');
    expect(result.features.f5FrameShare).toBeGreaterThanOrEqual(0.9);
  });

  it('AC-H1 bot-quantized 50 ms reactions are rejected physically-impossible-rt', () => {
    const stimuli = Array.from({ length: 10 }, (_, i) => ({ visibleAtUs: i * 1_000_000, respondedAtUs: i * 1_000_000 + 50_000 }));
    const result = classifyHumanness({ events: [], stimuli });
    expect(result.verdict).toBe('rejected');
    expect(result.reasons).toContain('physically-impossible-rt');
    expect(result.features.f2MedianRtMs).toBe(50);
  });

  it('AC-H1 bot-quantized copied intervals are rejected physically-impossible-replay', () => {
    const events = Array.from({ length: 51 }, (_, i) => ({ tUs: offGrid(1000 + i * 250_000), code: 'gas', down: true, trusted: true }));
    const otherIntervalsMs = intervalsMs(events);
    expect(otherIntervalsMs).toHaveLength(50);
    const result = classifyHumanness({ events, otherIntervalsMs });
    expect(result.features.f4MatchRun).toBeGreaterThanOrEqual(50);
    expect(result.verdict).toBe('rejected');
    expect(result.reasons).toContain('physically-impossible-replay');
  });

  it('AC-H1 bot-quantized empty pointer traces are rejected physically-impossible-teleport', () => {
    const result = classifyHumanness({ events: [], pointers: [{ points: 0 }, { points: 0 }, { points: 0 }] });
    expect(result.features.f6Teleports).toBe(3);
    expect(result.verdict).toBe('rejected');
    expect(result.reasons).toContain('physically-impossible-teleport');
  });

  it('AC-H2 human-like varied trace with a steer-down is verified', () => {
    const input = humanInput(HUMAN_GAPS, [280, 460]);
    expect(input.events.filter((event) => event.trusted === true).length).toBe(input.events.length);
    expect(input.events.some((event) => event.code === 'steer' && event.down)).toBe(true);
    const result = classifyHumanness(input);
    expect(result.reasons).toEqual([]);
    expect(result.score).toBeGreaterThanOrEqual(70);
    expect(result.verdict).toBe('verified');
  });

  it('AC-H3 drowsy varied trace is verified and not rejected', () => {
    const input = humanInput(DROWSY_GAPS, [520, 980]);
    const result = classifyHumanness(input);
    expect(result.features.f3Corrections).toBe(1);
    expect(result.features.f7DwellCv).toBeGreaterThanOrEqual(0.05);
    expect(result.score).toBeGreaterThanOrEqual(70);
    expect(result.verdict).toBe('verified');
  });

  it('ACH-T-02 an untrusted event without an impossibility is flagged_for_review', () => {
    const input = humanInput(HUMAN_GAPS, [280, 460]);
    input.events = input.events.map((event, i) => (i === 0 ? { ...event, trusted: false } : event));
    const result = classifyHumanness(input);
    expect(result.verdict).toBe('flagged_for_review');
    expect(result.verdict).not.toBe('rejected');
    expect(result.reasons).toEqual(['untrusted-input']);
  });

  it('ACH-T-03 a low score without an impossibility is human-review and not rejected', () => {
    const result = classifyHumanness({
      events: Array.from({ length: 9 }, (_, i) => ({ tUs: i * FRAME_US, code: 'gas', down: true, trusted: true })),
      stimuli: Array.from({ length: 9 }, (_, i) => ({ visibleAtUs: i * 1_000_000, respondedAtUs: i * 1_000_000 + 50_000 })),
      holdsMs: Array.from({ length: 10 }, () => 100),
      pointers: [{ points: 0 }, { points: 0 }],
      similarity: 0.9,
    });
    expect(result.score).toBeLessThan(70);
    expect(result.verdict).toBe('flagged_for_review');
    expect(result.verdict).not.toBe('rejected');
    expect(result.reasons).toEqual(['human-review']);
  });
});
