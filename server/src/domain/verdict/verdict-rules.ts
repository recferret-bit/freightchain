/* Thresholds of the verdict (verified play). The server uses shared simulation kernels for diagnostic reconstruction and it validates the recording (chain, bounds, agreement with what was
   reported), measures how human the input timing is, and checks the answers to the dispatch prompts it issued. Only a broken / missing / inconsistent
   recording – or prompts ignored for most of the ride – REJECTS; timing statistics only FLAG (a flagged ride does not rank until someone looks at it) –
   they start loose and are meant to be tightened on real data. Since version 3 the recording is also held against the server's own rebuild of the ride's road
   (holes, off-road, speed without gas – world-checks.ts). Version 4 (the pentest of 2026-10): the samples must really cover the time the batches declare
   (recording-empty, sample-gap, coverage from the samples and at least the governor's time for the distance), the position must not outrun its own
   speedometer (speed-mismatch), the gas bit must match the gas presses (inputs-mismatch, flag) and a coarse clock no longer switches timing checks off.
   Bump RULES_VERSION on any change. */
export const RULES_VERSION = 7;

/** a recorded speed above MAX_SPEED × this rejects (the governor is 28 m/s; float noise and the ±1 % display jitter fit under it) */
export const SPEED_TOLERANCE = 1.05;
/** |Δs| between two consecutive samples may be up to MAX_SPEED × Δt × this + TELEPORT_SLACK_METRES */
export const TELEPORT_FACTOR = 1.2;
export const TELEPORT_SLACK_METRES = 2;
/** …plus this on a step where the game may have moved the truck onto the other road of a fork (from the server's layout: RoadLayout.forkSwitch, never the
    client's column): re-measured on the new road, s jumps up to ≈ 3 m forward (client/js/net/orchestrator.js switchFork). Applies only to forks, which only
    the free levels' trips have – no ride judged before had one, so RULES_VERSION stays */
export const FORK_SWITCH_SLACK_METRES = 3.5;
/** the last recorded distance vs the distance the ride ended with: ≤ this + AGREE_SHARE of it */
export const AGREE_METRES = 30;
export const AGREE_SHARE = 0.01;
/** recorded game seconds ÷ the server's driven seconds: below REJECT the recording does not cover the ride, below FLAG it has holes */
export const COVERAGE_REJECT = 0.5;
export const COVERAGE_FLAG = 0.9;
/** a ride that moved further than this must have input events, and gas presses among them – and samples ('recording-empty') */
export const MOVED_METRES = 50;
/* Since the pentest of 2026-10 (fix-plan H1 / H3; measured since then – older batches have no opinion here) */
/** the longest game-time gap between two samples (the game samples every 0.1 s of its own clock): above this the recording has holes it hides by
    declaring [t0, t1] around them – 'sample-gap' rejects */
export const SAMPLE_GAP_REJECT = 1;
/** s may run ahead of the recorded speed (Σ Δs − Σ max(v)·Δt over the ride: curves, a push, rounding) by this + MISMATCH_SHARE of the distance; more is a
    position that outruns its own speedometer – 'speed-mismatch' rejects */
export const MISMATCH_METRES = 50;
export const MISMATCH_SHARE = 0.01;
/** rising edges of the gas bit in the samples vs gas presses among the input events: more edges than presses × this + INPUT_EDGE_SLACK flags
    'inputs-mismatch' (the samples show a gas pedal the events never pressed – events made up for someone else's samples) */
export const INPUT_EDGE_RATIO = 1.5;
export const INPUT_EDGE_SLACK = 5;
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
/** Coarse timers: some browsers round performance.now() (Firefox with resistFingerprinting / Tor: 16.7–100 ms) – detected when ≥ TIMER_ALIGN_SHARE of the
    event times sit on a multiple of one of TIMER_STEPS_MS. The checks then judge on the clock's own grid instead of being skipped (pentest 2026-10, fix-plan L1:
    the step is read off the attacker's own event times, so a skip was an escape): 'repeated-timings' buckets the intervals by the step (a person's gaps still
    spread over seconds); 'instant-presses' counts holds under the step – and from COARSE_TIMER_MS up, where a real quick tap often reads 0 ms, only holds that
    read 0, against INSTANT_SHARE_MAX_COARSE. 10 and 20 ms are no coarse clock any browser has: not in the list. */
export const TIMER_STEPS_MS: readonly number[] = [100, 50, 1000 / 60];
export const COARSE_TIMER_MS = 50;
export const TIMER_ALIGN_SHARE = 0.95;
export const INSTANT_SHARE_MAX_COARSE = 0.9;

/* dispatch prompts (domain/rides/ride-challenge.ts): the server asked for a key during the ride; the recording must show it pressed in the window */
/** a press this soon after the server issued the prompt is faster than a person who had to read it (the one-way network delay only makes a real
    reaction read SHORTER, so this stays well under the ~250 ms a person needs) – scripted, flag */
export const CHALLENGE_MIN_REACTION_MS = 80;
/** with at least this many answered prompts, a median reaction under CHALLENGE_MIN_REACTION_MS flags 'challenge-reflex' */
export const CHALLENGE_REFLEX_MIN_ANSWERED = 2;
/** with at least this many prompts issued, missing this share of them (or more) REJECTS – nobody was driving; fewer missed prompts only flag */
export const CHALLENGE_IGNORED_MIN_ISSUED = 3;
export const CHALLENGE_IGNORED_SHARE = 0.5;

/* the server's road (domain/road – rebuilt from the ride's seed; the game draws and drives over the same plan): what the truck in the recording did at
   every planned hole, off the tarmac, and with the gas pedal up (domain/telemetry/world-facts.ts measures, verdict/world-checks.ts decides) */
/** a wheel within this many metres of a pit's edge is too close to call (the rows are 10 Hz; d is interpolated): neither a hit nor a miss is judged */
export const PASS_CLEAR_METRES = 0.4;
/** an axle pass whose damage in the game would be below this (hull %) is not judged – a crawl through a hole hardly scratches the truck */
export const PASS_MIN_DAMAGE = 1;
/** a judged pass must show at least this share of the game's damage in the hull (rounding, the v interpolation, a rear axle after the front one slowed the truck) */
export const PASS_DAMAGE_SHARE = 0.25;
/** this many holes driven through with no damage at all REJECT ('obstacle-ignored': the game never had them); one flags ('obstacle-no-impact') */
export const OBSTACLE_IGNORED_REJECT = 2;
/** this many holes driven through at a damaging speed that could not be measured – no sample before the pit in that batch nor in the stored batch before
    it – flag 'obstacle-unmeasured'. Since 2026-10 the server takes batches only in order (UploadBatchHandler: 429 until the one before is stored), so only
    a recording stored before that can show it */
export const OBSTACLE_UNMEASURED_FLAG = 2;
/** the game ends the ride after OFFROAD_FAIL_SECONDS off the tarmac: a recording that stays off longer than this × that + OFFROAD_SLACK_SECONDS rejects */
export const OFFROAD_FACTOR = 1.25;
export const OFFROAD_SLACK_SECONDS = 2;
/** a step where the speed rose by at least this with the gas pedal up (flat road: only the engine can speed the truck up) counts */
export const GASLESS_MIN_DV = 0.15;
/** this much speed gained without gas over the ride (m/s), or this many such steps, REJECTS ('accel-without-gas'); fewer flag */
export const GASLESS_REJECT_GAIN = 2;
export const GASLESS_REJECT_STEPS = 5;
