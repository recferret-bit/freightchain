/* Limits on one recording batch. The client (client/js/telemetry.js) samples at SAMPLE_HZ of GAME time and uploads every ~15 s – keep these in step with it. */
export const SAMPLE_HZ = 10;
export const SAMPLE_RATE_SLACK = 1.5; // a batch may hold up to span × SAMPLE_HZ × this + SAMPLE_COUNT_SLACK samples (dt jitter, a batch cut mid-second)
export const SAMPLE_COUNT_SLACK = 5;
export const BATCH_MAX_SAMPLES = 400; // ≈ 40 s at 10 Hz – a 15 s batch is 150
export const BATCH_MAX_INPUTS = 2000;
export const SAMPLE_MAX_WIDTH = 16; // numbers per sample row
export const BATCH_MAX_BYTES = 98_304; // canonical JSON; below Express's default 100 kB body limit (a real 15 s batch is ≈ 15 kB)
export const BATCH_MAX_SEQ = 100_000;
export const MAX_GAME_SECONDS = 1e7;
export const INPUT_CODE_MAX_LENGTH = 32;
/** batches are still taken this long after the ride ended: the client flushes its last one around /end */
export const RECORDING_GRACE_MS = 60_000;
