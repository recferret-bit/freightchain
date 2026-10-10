/* Limits on one recording batch. The client (client/js/telemetry.js) samples at SAMPLE_HZ of GAME time and uploads every ~15 s – keep these in step with it. */
export const SAMPLE_HZ = 10;
export const SAMPLE_RATE_SLACK = 1.5; // a batch may hold up to span × SAMPLE_HZ × this + SAMPLE_COUNT_SLACK samples (dt jitter, a batch cut mid-second)
export const SAMPLE_COUNT_SLACK = 5;
export const BATCH_MAX_SAMPLES = 400; // ≈ 40 s at 10 Hz – a 15 s batch is 150
export const BATCH_MAX_INPUTS = 2000;
export const SAMPLE_MAX_WIDTH = 16; // numbers per sample row
export const SAMPLE_WIDTH = 12; // the columns the verdict reads: [t, s, d, psi, v, rpm, gear, hull, gas, brake, steer, clutch] (replay columns are appended after)
/* The replay columns – appended for spectators (client/js/watch.js), inside the hashed text like the rest, NEVER judged (the verdict reads SAMPLE_WIDTH);
   older recordings stop earlier. Append, never insert. */
export const SAMPLE_CLOCK_COL = 12; // the hour of the day (0..24)
export const SAMPLE_FLAGS_COL = 13; // the cab's switches (client/js/telemetry.js FLAGS)
/** the driver's controls: held at the sample OR pressed since the one before – one bit per control + one for "clicked on the dash" (client/js/input-bits.js).
    Nothing finer than a sample: the raw input events (ms timing, the human-likeness check) are never served to spectators. */
export const SAMPLE_INPUT_COL = 14;
/** which road of a fork the truck is on (0 / 1, 0 outside a fork – client/js/net/network.js): the replay draws that one. Both roads are one road in (s, d), so
    the judge never needs it (domain/road: the fork's corridor). */
export const SAMPLE_FORK_COL = 15;
export const SAMPLE_TIME_SLACK = 0.05; // sample times may stick out of their batch's [t0, t1] by this much (rounding)
export const BATCH_MAX_BYTES = 98_304; // canonical JSON; below Express's default 100 kB body limit (a real 15 s batch is ≈ 15 kB)
export const BATCH_MAX_SEQ = 100_000;
export const MAX_GAME_SECONDS = 1e7;
export const INPUT_CODE_MAX_LENGTH = 32;
/** Input codes that start with this are the in-game PHONE's events (client/js/telemetry.js recordPhone: its taps, pans, power / boot, route lost). They are kept in the recording
    for audits and replays but are NOT driving: the verdict never counts them as an input, as a press, or in the human-timing statistics. */
export const PHONE_PREFIX = 'phone:';
export const isPhoneInput = (e: readonly [number, string, number]): boolean => e[1].startsWith(PHONE_PREFIX);
/* The traffic track beside a batch (live streams' replays: client/js/telemetry.js TRAFFIC_HZ = 2 frames per game second, each [t, …7 numbers per nearby
   vehicle, ≤ 16 vehicles]). Display only – OUTSIDE the canonical (hashed) text, never judged; one that breaks these limits is DROPPED, never refused
   (a refused batch would break the recording's chain for something the verdict does not even read). */
export const TRAFFIC_MAX_FRAMES = 80;
export const TRAFFIC_MAX_ROW = 1 + 7 * 16;
export const TRAFFIC_MAX_BYTES = 48_000;
/* What a ride may have uploaded by now, from the SERVER's wall clock since the start (caps storage per ride: a client cannot stream data faster than it drives).
   The game clock never runs ahead of wall time (frames are clamped, the tab pauses when hidden), so: */
/** a batch's game time may not exceed the wall seconds since the start × this + GAME_TIME_SLACK_SECONDS */
export const GAME_TIME_FACTOR = 1.05;
export const GAME_TIME_SLACK_SECONDS = 30;
/** the client cuts a batch every 15 s (+ the final flush): a seq beyond wall seconds / MIN_BATCH_SECONDS + BATCH_SEQ_SLACK is refused */
export const MIN_BATCH_SECONDS = 5;
export const BATCH_SEQ_SLACK = 10;

/** a ride may hold at most wall seconds since the start × this many canonical bytes + RECORDING_BYTES_SLACK (a real recording is ≈ 1 kB/s; the traffic track is not counted) */
export const RECORDING_BYTES_PER_SECOND = 4096;
export const RECORDING_BYTES_SLACK = 262_144;

export interface RecordingAllowance {
  maxGameSeconds: number;
  maxSeq: number;
  maxBytes: number;
}

/** batches are still taken this long after the ride ended: the client flushes its last one around /end */
export const RECORDING_GRACE_MS = 60_000;
