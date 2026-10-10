/* Ride-challenge channel (verified play). The heartbeat can issue one, the cab handler shows whatever the DTO names
   (client/js/prompt.js), the verdict looks for that press in the recording (challenge-checks.ts).
   A kind is a row in CHALLENGE_KINDS. The table is empty today: nothing is issued. Add a row to turn a kind on.
   prompt.js does not know the kinds. A new answering key must already be recorded (ui/input.js + input-bits.js). */

export interface ChallengeKind {
  action: string;
  /** what the driver reads */
  label: string;
  /** the key printed in the prompt */
  key: string;
  /** input codes (KeyboardEvent.code or a dash button) that answer it – any of them counts */
  codes: readonly string[];
}

/** Shipped kinds. Empty: the channel is in place and issues nothing. Add a row to turn a kind on. */
export const CHALLENGE_KINDS: readonly ChallengeKind[] = [];

export type ChallengeAction = string;

export const challengeKind = (action: string, kinds: readonly ChallengeKind[] = CHALLENGE_KINDS): ChallengeKind | undefined =>
  kinds.find((k) => k.action === action);

/** how long the driver has, from the moment the server issued it (the prompt counts down on the windscreen) */
export const CHALLENGE_WINDOW_MS = 20_000;
/** a ride never holds more prompts than this (an 8 h shift at one per 4 min is 120) */
export const CHALLENGE_MAX_PER_RIDE = 200;
/** the first prompt waits at least this share of the interval, so a driver gets going first */
export const CHALLENGE_FIRST_MIN = 0.5;
/** at most this many prompts per shift, whatever the interval: a short (demo / test) shift gets interval = minSeconds / this */
export const CHALLENGE_PER_SHIFT_MAX = 4;

/** One prompt as the ride stores it. Times are milliseconds since the ride STARTED on the server's clock – the same axis as the recording's input events (which the client counts from the moment /start answered). `codes` is frozen at issue so a later kinds-table change does not rewrite history. */
export interface RideChallenge {
  id: string;
  action: ChallengeAction;
  issuedMs: number;
  deadlineMs: number;
  codes?: readonly string[];
}

/** The wire view (the heartbeat response): what to show and which keys answer it. The cab handler is generic – it never looks the action up. */
export interface ChallengeDto {
  id: string;
  action: ChallengeAction;
  label: string;
  key: string;
  codes: string[];
  issuedMs: number;
  deadlineMs: number;
}

export const toChallengeDto = (c: RideChallenge, kinds: readonly ChallengeKind[] = CHALLENGE_KINDS): ChallengeDto | null => {
  const kind = challengeKind(c.action, kinds);
  if (!kind) return null;
  return { id: c.id, action: c.action, label: kind.label, key: kind.key, codes: [...kind.codes], issuedMs: c.issuedMs, deadlineMs: c.deadlineMs };
};

/** The gap between prompts for a shift of `minSeconds`: the configured interval, but never fewer than CHALLENGE_PER_SHIFT_MAX prompts' worth of a short shift. 0 = prompts are off. */
export const challengeInterval = (intervalSeconds: number, minSeconds: number): number => (intervalSeconds <= 0 ? 0 : Math.min(intervalSeconds, minSeconds / CHALLENGE_PER_SHIFT_MAX));

/** Drive-seconds at which the first prompt is due: half the interval, plus up to half of it at random. */
export const firstChallengeAt = (interval: number, rnd: number): number => interval * (CHALLENGE_FIRST_MIN + (1 - CHALLENGE_FIRST_MIN) * clamp01(rnd));
/** Drive-seconds at which the next one is due after `issuedAt`: 0.6–1.4 × the interval, so the rhythm cannot be anticipated. */
export const nextChallengeAt = (issuedAt: number, interval: number, rnd: number): number => issuedAt + interval * (0.6 + 0.8 * clamp01(rnd));
/** Which prompt: a uniform draw across `kinds`. Empty table → null. */
export const pickChallenge = (rnd: number, kinds: readonly ChallengeKind[] = CHALLENGE_KINDS): ChallengeKind | null => {
  if (kinds.length === 0) return null;
  return kinds[Math.min(kinds.length - 1, Math.floor(clamp01(rnd) * kinds.length))] ?? null;
};

const clamp01 = (v: number): number => (Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0);

/** The stored JSON of a ride's prompts, validated (a row is never trusted blindly). Unknown actions are dropped so a retired kind cannot poison a row. */
export function parseChallenges(raw: unknown, kinds: readonly ChallengeKind[] = CHALLENGE_KINDS): RideChallenge[] {
  if (!Array.isArray(raw)) return [];
  const out: RideChallenge[] = [];
  for (const c of raw) {
    if (typeof c !== 'object' || c === null) continue;
    const { id, action, issuedMs, deadlineMs, codes } = c as Record<string, unknown>;
    if (typeof id !== 'string' || typeof action !== 'string' || typeof issuedMs !== 'number' || typeof deadlineMs !== 'number') continue;
    if (!kinds.some((k) => k.action === action)) continue;
    const parsed: RideChallenge = { id, action, issuedMs, deadlineMs };
    if (Array.isArray(codes) && codes.every((x) => typeof x === 'string')) parsed.codes = codes;
    out.push(parsed);
  }
  return out;
}
