/* Dispatch prompts (verified play, "challenge prompts"): while a ride runs the server asks the driver, through the heartbeat response, to do one small
   thing in the cab – flash the headlights, run the wipers… – and the recording must show that key pressed within the window. A bot that does not read
   the prompt never answers; one that answers the instant the response arrives is faster than a person can be. The game shows the prompt on the
   windscreen (client/js/prompt.js); the verdict judges the answers from the recording alone (domain/verdict/challenge-checks.ts). */

export type ChallengeAction = 'headlights' | 'wipers' | 'cab' | 'washer';

export interface ChallengeKind {
  action: ChallengeAction;
  /** what the driver reads */
  label: string;
  /** the key in the prompt */
  key: string;
  /** input codes (KeyboardEvent.code or a dash button) that answer it – any of them counts */
  codes: readonly string[];
}

/** the four things every cab can do at any time, by keyboard or by a dash button (client/js/ui/input.js) */
export const CHALLENGE_KINDS: readonly ChallengeKind[] = [
  { action: 'headlights', label: 'FLASH YOUR HEADLIGHTS', key: 'L', codes: ['KeyL', 'btn:head'] },
  { action: 'wipers', label: 'RUN THE WIPERS', key: 'R', codes: ['KeyR', 'btn:wiper'] },
  { action: 'cab', label: 'SWITCH THE CAB LIGHT', key: 'C', codes: ['KeyC', 'btn:cab'] },
  { action: 'washer', label: 'SPRAY THE WASHER', key: 'X', codes: ['KeyX', 'btn:wash'] },
];

export const challengeKind = (action: ChallengeAction): ChallengeKind => CHALLENGE_KINDS.find((k) => k.action === action) ?? (CHALLENGE_KINDS[0] as ChallengeKind);

/** how long the driver has, from the moment the server issued it (the prompt counts down on the windscreen) */
export const CHALLENGE_WINDOW_MS = 20_000;
/** a ride never holds more prompts than this (an 8 h shift at one per 4 min is 120) */
export const CHALLENGE_MAX_PER_RIDE = 200;
/** the first prompt waits at least this share of the interval, so a driver gets going first */
export const CHALLENGE_FIRST_MIN = 0.5;
/** at most this many prompts per shift, whatever the interval: a short (demo / test) shift gets interval = minSeconds / this */
export const CHALLENGE_PER_SHIFT_MAX = 4;

/** One prompt as the ride stores it. Times are milliseconds since the ride STARTED on the server's clock – the same axis as the recording's input events (which the client counts from the moment /start answered). */
export interface RideChallenge {
  id: string;
  action: ChallengeAction;
  issuedMs: number;
  deadlineMs: number;
}

/** The wire view (the heartbeat response): what to show and which keys answer it. */
export interface ChallengeDto {
  id: string;
  action: ChallengeAction;
  label: string;
  key: string;
  codes: string[];
  issuedMs: number;
  deadlineMs: number;
}

export const toChallengeDto = (c: RideChallenge): ChallengeDto => {
  const kind = challengeKind(c.action);
  return { id: c.id, action: c.action, label: kind.label, key: kind.key, codes: [...kind.codes], issuedMs: c.issuedMs, deadlineMs: c.deadlineMs };
};

/** The gap between prompts for a shift of `minSeconds`: the configured interval, but never fewer than CHALLENGE_PER_SHIFT_MAX prompts' worth of a short shift. 0 = prompts are off. */
export const challengeInterval = (intervalSeconds: number, minSeconds: number): number => (intervalSeconds <= 0 ? 0 : Math.min(intervalSeconds, minSeconds / CHALLENGE_PER_SHIFT_MAX));

/** Drive-seconds at which the first prompt is due: half the interval, plus up to half of it at random. */
export const firstChallengeAt = (interval: number, rnd: number): number => interval * (CHALLENGE_FIRST_MIN + (1 - CHALLENGE_FIRST_MIN) * clamp01(rnd));
/** Drive-seconds at which the next one is due after `issuedAt`: 0.6–1.4 × the interval, so the rhythm cannot be anticipated. */
export const nextChallengeAt = (issuedAt: number, interval: number, rnd: number): number => issuedAt + interval * (0.6 + 0.8 * clamp01(rnd));
/** Which prompt: the kinds in turn, picked by the random draw. */
export const pickChallenge = (rnd: number): ChallengeKind => CHALLENGE_KINDS[Math.min(CHALLENGE_KINDS.length - 1, Math.floor(clamp01(rnd) * CHALLENGE_KINDS.length))] as ChallengeKind;

const clamp01 = (v: number): number => (Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0);

/** The stored JSON of a ride's prompts, validated (a row is never trusted blindly). */
export function parseChallenges(raw: unknown): RideChallenge[] {
  if (!Array.isArray(raw)) return [];
  const out: RideChallenge[] = [];
  for (const c of raw) {
    if (typeof c !== 'object' || c === null) continue;
    const { id, action, issuedMs, deadlineMs } = c as Record<string, unknown>;
    if (typeof id !== 'string' || typeof action !== 'string' || typeof issuedMs !== 'number' || typeof deadlineMs !== 'number') continue;
    if (!CHALLENGE_KINDS.some((k) => k.action === action)) continue;
    out.push({ id, action: action as ChallengeAction, issuedMs, deadlineMs });
  }
  return out;
}
