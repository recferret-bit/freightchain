/* Thresholds of the verdict (verified play). The server re-simulates NOTHING: it validates the recording (chain, bounds, agreement with what was
   reported), measures how human the input timing is, and checks the answers to the dispatch prompts it issued. Only a broken / missing / inconsistent
   recording – or prompts ignored for most of the ride – REJECTS; timing statistics only FLAG (a flagged ride does not rank until someone looks at it) –
   they start loose and are meant to be tightened on real data. Bump RULES_VERSION on any change. */
export const RULES_VERSION = 2;

/** a recorded speed above MAX_SPEED × this rejects (the governor is 28 m/s; float noise and the ±1 % display jitter fit under it) */
export const SPEED_TOLERANCE = 1.05;
/** |Δs| between two consecutive samples may be up to MAX_SPEED × Δt × this + TELEPORT_SLACK_METRES */
export const TELEPORT_FACTOR = 1.2;
export const TELEPORT_SLACK_METRES = 2;
/** the last recorded distance vs the distance the ride ended with: ≤ this + AGREE_SHARE of it */
export const AGREE_METRES = 30;
export const AGREE_SHARE = 0.01;
/** recorded game seconds ÷ the server's driven seconds: below REJECT the recording does not cover the ride, below FLAG it has holes */
export const COVERAGE_REJECT = 0.5;
export const COVERAGE_FLAG = 0.9;
/** a ride that moved further than this must have input events, and gas presses among them */
export const MOVED_METRES = 50;
export const GAS_CODES: readonly string[] = ['KeyW', 'ArrowUp'];

/* human-likeness (flag only) */
/** below this many press/release pairs the timing checks have no opinion (a 60 s demo ride must not flag itself) */
export const HUMAN_MIN_PRESSES = 8;
/** per key with ≥ HOLD_MIN_PER_KEY holds: a coefficient of variation of the hold durations below this looks scripted (people land around 0.3–0.8) */
export const HOLD_CV_MIN = 0.08;
export const HOLD_MIN_PER_KEY = 6;
/** the REPEAT_TOP_N most common press-to-press intervals (1 ms buckets) covering more than this share of all intervals looks scripted (a person's
    intervals spread over seconds, so any 1 ms bucket holds a percent or two; a script cycling through a few fixed delays fills almost all of them) */
export const REPEAT_TOP_N = 3;
export const REPEAT_SHARE_MAX = 0.6;
/** presses released within this many ms (a script's down+up in one tick) */
export const INSTANT_HOLD_MS = 10;
export const INSTANT_SHARE_MAX = 0.3;
/** Coarse timers: some browsers round performance.now() (Firefox with resistFingerprinting / Tor: 16.7–100 ms). On such a clock quick taps read as 0 ms
    and intervals fall into a few buckets, so 'instant-presses' and 'repeated-timings' would flag real people – they are skipped when ≥ TIMER_ALIGN_SHARE of
    the event times sit on a multiple of one of TIMER_STEPS_MS (≥ COARSE_TIMER_MS). The hold-variation check still runs. */
export const TIMER_STEPS_MS: readonly number[] = [100, 50, 20, 1000 / 60, 10];
export const COARSE_TIMER_MS = 10;
export const TIMER_ALIGN_SHARE = 0.95;

/* dispatch prompts (domain/rides/ride-challenge.ts): the server asked for a key during the ride; the recording must show it pressed in the window */
/** a press this soon after the server issued the prompt is faster than a person who had to read it (the one-way network delay only makes a real
    reaction read SHORTER, so this stays well under the ~250 ms a person needs) – scripted, flag */
export const CHALLENGE_MIN_REACTION_MS = 80;
/** with at least this many answered prompts, a median reaction under CHALLENGE_MIN_REACTION_MS flags 'challenge-reflex' */
export const CHALLENGE_REFLEX_MIN_ANSWERED = 2;
/** with at least this many prompts issued, missing this share of them (or more) REJECTS – nobody was driving; fewer missed prompts only flag */
export const CHALLENGE_IGNORED_MIN_ISSUED = 3;
export const CHALLENGE_IGNORED_SHARE = 0.5;
