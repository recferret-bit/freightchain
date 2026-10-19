import { challengeKind, type RideChallenge } from '../rides/ride-challenge.js';
import type { InputEvent } from '../telemetry/ride-batch.entity.js';
import { CHALLENGE_IGNORED_MIN_ISSUED, CHALLENGE_IGNORED_SHARE, CHALLENGE_MIN_REACTION_MS, CHALLENGE_REFLEX_MIN_ANSWERED } from './verdict-rules.js';
import type { VerdictReason } from './verdict.dto.js';

/* Did the driver answer the dispatch prompts the server issued? Both clocks count milliseconds from the ride's start (the server from startedAt, the
   client from the moment /start answered – a network delay apart), so a prompt issued at `issuedMs` is answered by the first press of one of its codes
   in [issuedMs, deadlineMs]. A prompt whose window had not closed when the ride ended is not judged. Nothing here is simulated. */

export interface ChallengeScores {
  issued: number;
  answered: number;
  missed: number;
  /** answered faster than CHALLENGE_MIN_REACTION_MS */
  tooFast: number;
  medianReactionMs: number | null;
}

const reject = (code: string, detail: string): VerdictReason => ({ code, detail, severity: 'reject' });
const flag = (code: string, detail: string): VerdictReason => ({ code, detail, severity: 'flag' });

/** `endMs` = how long the ride ran (ms); prompts still open at the end are left out. */
export function checkChallenges(challenges: readonly RideChallenge[], inputs: readonly InputEvent[], endMs: number): { reasons: VerdictReason[]; scores: ChallengeScores } {
  const downs = inputs.filter((e) => e[2] === 1).sort((a, b) => a[0] - b[0]);
  const judged = challenges.filter((c) => c.deadlineMs <= endMs);
  const reactions: number[] = [];
  let missed = 0;
  for (const c of judged) {
    const codes: readonly string[] = c.codes ?? challengeKind(c.action)?.codes ?? [];
    const hit = downs.find((e) => e[0] >= c.issuedMs && e[0] <= c.deadlineMs && codes.includes(e[1]));
    if (hit) reactions.push(hit[0] - c.issuedMs);
    else missed++;
  }
  const sorted = [...reactions].sort((a, b) => a - b);
  const median = sorted.length ? (sorted[(sorted.length - 1) >> 1]! + sorted[sorted.length >> 1]!) / 2 : null;
  const tooFast = reactions.filter((r) => r < CHALLENGE_MIN_REACTION_MS).length;
  const scores: ChallengeScores = { issued: judged.length, answered: reactions.length, missed, tooFast, medianReactionMs: median === null ? null : Math.round(median) };
  const out: VerdictReason[] = [];
  if (judged.length >= CHALLENGE_IGNORED_MIN_ISSUED && missed / judged.length >= CHALLENGE_IGNORED_SHARE) {
    out.push(reject('challenges-ignored', `${missed} of ${judged.length} dispatch prompts went unanswered`));
  } else if (missed > 0) {
    out.push(flag('challenge-missed', `${missed} of ${judged.length} dispatch prompts went unanswered`));
  }
  if (reactions.length >= CHALLENGE_REFLEX_MIN_ANSWERED && median !== null && median < CHALLENGE_MIN_REACTION_MS) {
    out.push(flag('challenge-reflex', `prompts answered ${Math.round(median)} ms after they were issued – faster than a person can read them`));
  }
  return { reasons: out, scores };
}
