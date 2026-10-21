import { CODE_ATTEMPTS, CODE_PENALTY_S, DECISION_ATTEMPTS } from './kinds.js';

export type ScoreOutcome = 'passed' | 'failed' | 'pending';

export interface ScoreResult {
  outcome: ScoreOutcome;
  penaltyS: number;
  attempts: number;
  terminal: boolean;
}

/**
 * Code entry: 3 tries. Penalty +20 only when all 3 are wrong. A later correct try passes with penalty 0.
 * Decision games: 1 try, no time penalty. `cancelled` is not an outcome — a missed bay is `missed` (see close.ts).
 */
export function scoreAttempt(kind: 'code' | 'decision', attempt: number, correct: boolean): ScoreResult {
  const cap = kind === 'code' ? CODE_ATTEMPTS : DECISION_ATTEMPTS;
  const n = Math.max(1, Math.min(cap, attempt));
  if (correct) return { outcome: 'passed', penaltyS: 0, attempts: n, terminal: true };
  if (n >= cap) return { outcome: 'failed', penaltyS: kind === 'code' ? CODE_PENALTY_S : 0, attempts: n, terminal: true };
  return { outcome: 'pending', penaltyS: 0, attempts: n, terminal: false };
}
