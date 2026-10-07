import type { InputEvent } from '../telemetry/ride-batch.entity.js';
import { HOLD_CV_MIN, HOLD_MIN_PER_KEY, HUMAN_MIN_PRESSES, INSTANT_HOLD_MS, INSTANT_SHARE_MAX, REPEAT_SHARE_MAX, REPEAT_TOP_N } from './verdict-rules.js';
import type { VerdictReason } from './verdict.dto.js';

/* How human does the input timing look? People hold and space their key presses irregularly; scripts repeat the same numbers or press and release
   in the same tick. Statistics only, never a simulation – and these only FLAG (a person reviews it), they never reject on their own. */

export interface HumanScores {
  presses: number;
  /** the lowest per-key coefficient of variation of hold durations (null = no key had enough holds) */
  minHoldCv: number | null;
  /** share of press-to-press intervals covered by the REPEAT_TOP_N most common ones (1 ms buckets) */
  repeatShare: number | null;
  /** share of presses released within INSTANT_HOLD_MS */
  instantShare: number | null;
}

const flag = (code: string, detail: string): VerdictReason => ({ code, detail, severity: 'flag' });
const round = (v: number) => Math.round(v * 1000) / 1000;

const cv = (xs: readonly number[]): number => {
  const mean = xs.reduce((a, b) => a + b, 0) / xs.length;
  if (mean <= 0) return 0;
  const variance = xs.reduce((a, x) => a + (x - mean) ** 2, 0) / xs.length;
  return Math.sqrt(variance) / mean;
};

/** Press → release pairs per code (a press with no release – the ride ended while held – is dropped). */
export function holdsByCode(events: readonly InputEvent[]): Map<string, number[]> {
  const open = new Map<string, number>(), holds = new Map<string, number[]>();
  for (const [t, code, down] of [...events].sort((a, b) => a[0] - b[0])) {
    if (down === 1) { if (!open.has(code)) open.set(code, t); continue; }
    const start = open.get(code);
    if (start === undefined) continue;
    open.delete(code);
    holds.set(code, [...(holds.get(code) ?? []), t - start]);
  }
  return holds;
}

export function checkHumanTiming(events: readonly InputEvent[]): { reasons: VerdictReason[]; scores: HumanScores } {
  const holds = holdsByCode(events);
  const all = [...holds.values()].flat();
  const scores: HumanScores = { presses: all.length, minHoldCv: null, repeatShare: null, instantShare: null };
  if (all.length < HUMAN_MIN_PRESSES) return { reasons: [], scores };
  const out: VerdictReason[] = [];

  const perKey = [...holds.entries()].filter(([, h]) => h.length >= HOLD_MIN_PER_KEY).map(([code, h]) => ({ code, cv: cv(h) }));
  if (perKey.length) {
    const worst = perKey.reduce((a, b) => (b.cv < a.cv ? b : a));
    scores.minHoldCv = round(worst.cv);
    if (worst.cv < HOLD_CV_MIN) out.push(flag('uniform-holds', `${worst.code} is held for the same time on every press (variation ${Math.round(worst.cv * 100)} %)`));
  }

  const downs = events.filter((e) => e[2] === 1).map((e) => e[0]).sort((a, b) => a - b);
  const gaps = downs.slice(1).map((t, i) => Math.round(t - (downs[i] ?? 0)));
  if (gaps.length) {
    const counts = new Map<number, number>();
    for (const g of gaps) counts.set(g, (counts.get(g) ?? 0) + 1);
    const top = [...counts.values()].sort((a, b) => b - a).slice(0, REPEAT_TOP_N).reduce((a, b) => a + b, 0) / gaps.length;
    scores.repeatShare = round(top);
    if (top > REPEAT_SHARE_MAX) out.push(flag('repeated-timings', `${Math.round(top * 100)} % of the presses come at one of ${REPEAT_TOP_N} exact intervals`));
  }

  const instant = all.filter((h) => h < INSTANT_HOLD_MS).length / all.length;
  scores.instantShare = round(instant);
  if (instant > INSTANT_SHARE_MAX) out.push(flag('instant-presses', `${Math.round(instant * 100)} % of the presses are released within ${INSTANT_HOLD_MS} ms`));
  return { reasons: out, scores };
}
