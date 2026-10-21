/** Stage-1 features from a 30 Hz inp stream. No calibrated human base and no SHAP (those stay out of this wave). */

export interface InpEvent {
  tUs: number;
  code: string;
  down: boolean;
  trusted?: boolean;
}

export interface StimulusRt {
  visibleAtUs: number;
  respondedAtUs: number;
}

export interface PointerTrace {
  /** Intermediate samples. 0 is a teleport onto the target. */
  points: number;
}

export interface HumannessFeatures {
  f1Cv: number;
  f1Entropy: number;
  f1Tau: number;
  f2MedianRtMs: number;
  f3Corrections: number;
  f4MatchRun: number;
  f5FrameShare: number;
  f6Teleports: number;
  f7DwellCv: number;
  f8RtSlope: number;
  f9Similarity: number;
  f10Untrusted: number;
}

export type HumannessVerdict = 'verified' | 'flagged_for_review' | 'rejected';

export interface HumannessInput {
  events: readonly InpEvent[];
  stimuli?: readonly StimulusRt[];
  holdsMs?: readonly number[];
  otherIntervalsMs?: readonly number[];
  pointers?: readonly PointerTrace[];
  /** Share of aligned intervals within 1 ms of another ride. 0 when there is no other ride. */
  similarity?: number;
}

export interface HumannessResult {
  features: HumannessFeatures;
  score: number;
  verdict: HumannessVerdict;
  reasons: string[];
}

const FRAME_US = 16667;
const T_OK = 70;
const T_REVIEW = 40;

export function coefficientOfVariation(values: readonly number[]): number {
  if (values.length < 2) return 1;
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  if (mean === 0) return 0;
  const variance = values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length;
  return Math.sqrt(variance) / mean;
}

export function shannonEntropy(values: readonly number[]): number {
  if (!values.length) return 0;
  const bins = new Map<number, number>();
  for (const value of values) {
    const bin = Math.floor(Math.log2(Math.max(value, 1e-6)));
    bins.set(bin, (bins.get(bin) ?? 0) + 1);
  }
  let entropy = 0;
  for (const count of bins.values()) {
    const p = count / values.length;
    entropy -= p * Math.log2(p);
  }
  return entropy;
}

/** Right-tail proxy (mean − median). A metronome has τ ≈ 0. */
export function exGaussianTau(values: readonly number[]): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)]!;
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  return Math.max(0, mean - median);
}

export function intervalsMs(events: readonly InpEvent[]): number[] {
  const sorted = [...events].sort((a, b) => a.tUs - b.tUs);
  const out: number[] = [];
  for (let i = 1; i < sorted.length; i++) out.push((sorted[i]!.tUs - sorted[i - 1]!.tUs) / 1000);
  return out;
}

/** Longest run of intervals that match another ride to within 1 ms, walking both sequences in order. */
export function matchingIntervalRun(left: readonly number[], right: readonly number[]): number {
  let best = 0;
  let run = 0;
  const n = Math.min(left.length, right.length);
  for (let i = 0; i < n; i++) {
    if (Math.abs(left[i]! - right[i]!) <= 1) { run += 1; best = Math.max(best, run); }
    else run = 0;
  }
  return best;
}

function median(values: readonly number[]): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)]!;
}

function featuresOf(input: HumannessInput): HumannessFeatures {
  const gaps = intervalsMs(input.events);
  const rts = (input.stimuli ?? []).map((row) => (row.respondedAtUs - row.visibleAtUs) / 1000);
  const holds = input.holdsMs ?? [];
  const frameHits = input.events.filter((event) => event.tUs % FRAME_US === 0).length;
  const teleports = (input.pointers ?? []).filter((trace) => trace.points === 0).length;
  const untrusted = input.events.filter((event) => event.trusted === false).length;
  const slope = rts.length < 2 ? 0 : (rts[rts.length - 1]! - rts[0]!) / rts.length;
  return {
    f1Cv: coefficientOfVariation(gaps),
    f1Entropy: shannonEntropy(gaps),
    f1Tau: exGaussianTau(gaps),
    f2MedianRtMs: median(rts),
    f3Corrections: input.events.filter((event) => event.code === 'steer' && event.down).length,
    f4MatchRun: matchingIntervalRun(gaps, input.otherIntervalsMs ?? []),
    f5FrameShare: input.events.length ? frameHits / input.events.length : 0,
    f6Teleports: teleports,
    f7DwellCv: coefficientOfVariation(holds),
    f8RtSlope: slope,
    f9Similarity: input.similarity ?? 0,
    f10Untrusted: input.events.length ? untrusted / input.events.length : 0,
  };
}

function impossibility(input: HumannessInput, features: HumannessFeatures): string[] {
  const reasons: string[] = [];
  const rts = (input.stimuli ?? []).map((row) => (row.respondedAtUs - row.visibleAtUs) / 1000);
  if (rts.length >= 10 && median(rts) < 100) reasons.push('physically-impossible-rt');
  const holds = input.holdsMs ?? [];
  if (holds.length >= 50 && coefficientOfVariation(holds) < 0.02) reasons.push('physically-impossible-holds');
  if (input.events.length >= 10 && features.f5FrameShare >= 0.9) reasons.push('physically-impossible-frame-grid');
  if (features.f4MatchRun >= 50) reasons.push('physically-impossible-replay');
  if (features.f6Teleports >= 3) reasons.push('physically-impossible-teleport');
  return reasons;
}

/** 0..100 from the features. One machine-like feature cannot zero the score. */
export function humannessScore(features: HumannessFeatures): number {
  let score = 100;
  if (features.f1Cv < 0.1) score -= 20;
  if (features.f1Tau < 1 && features.f1Entropy < 1) score -= 10;
  if (features.f2MedianRtMs > 0 && features.f2MedianRtMs < 120) score -= 15;
  if (features.f3Corrections === 0) score -= 5;
  if (features.f5FrameShare >= 0.5) score -= 15;
  if (features.f6Teleports > 0) score -= 10;
  if (features.f7DwellCv < 0.05) score -= 10;
  if (features.f8RtSlope === 0) score -= 5;
  if (features.f9Similarity >= 0.85) score -= 15;
  if (features.f10Untrusted > 0) score -= 10;
  return Math.max(0, Math.min(100, score));
}

export function classifyHumanness(input: HumannessInput): HumannessResult {
  const features = featuresOf(input);
  const score = humannessScore(features);
  const impossible = impossibility(input, features);
  if (impossible.length) return { features, score, verdict: 'rejected', reasons: impossible };
  const untrusted = input.events.some((event) => event.trusted === false);
  if (untrusted || (score >= T_REVIEW && score < T_OK)) return { features, score, verdict: 'flagged_for_review', reasons: untrusted ? ['untrusted-input'] : ['human-review'] };
  if (score < T_REVIEW) return { features, score, verdict: 'flagged_for_review', reasons: ['human-review'] };
  return { features, score, verdict: 'verified', reasons: [] };
}
