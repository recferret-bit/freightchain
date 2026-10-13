/* Live streams (spectators): what a signed-in spectator may post into a running ride's feed, and how often. Donations are a MOCK – the amount is shown and
   summed, nothing is charged (docs/agents/live.md: a wallet-to-wallet tip seen by the chain watcher).
   The game client mirrors EFFECTS (client/js/live.js – what each effect does, client/js/ui/watch-panel.js – the buttons). */

export const LAMPORTS_PER_SOL = 1_000_000_000;

/** A donation's effect. `tip` = money only; the others change the driver's game, applied by the driver's client and stamped back (`applied`). */
export const EFFECT_IDS = ['tip', 'night', 'day', 'potholes', 'trench', 'sinkhole'] as const;
export type EffectId = (typeof EFFECT_IDS)[number];

export interface EffectRule {
  /** the mock price */
  lamports: number;
  /** false = money only, nothing for the driver's game to do */
  game: boolean;
  /** an obstacle: the driver's client puts it on the road ahead and reports where (so every replay has it in the same place) */
  obstacle: boolean;
}
export const EFFECTS: Readonly<Record<EffectId, EffectRule>> = {
  tip: { lamports: 0.01 * LAMPORTS_PER_SOL, game: false, obstacle: false },
  night: { lamports: 0.02 * LAMPORTS_PER_SOL, game: true, obstacle: false },
  day: { lamports: 0.02 * LAMPORTS_PER_SOL, game: true, obstacle: false },
  potholes: { lamports: 0.02 * LAMPORTS_PER_SOL, game: true, obstacle: true },
  trench: { lamports: 0.03 * LAMPORTS_PER_SOL, game: true, obstacle: true },
  sinkhole: { lamports: 0.05 * LAMPORTS_PER_SOL, game: true, obstacle: true },
};
export const isEffectId = (v: unknown): v is EffectId => typeof v === 'string' && (EFFECT_IDS as readonly string[]).includes(v);

export const MESSAGE_MAX_LENGTH = 140;
/** a donation may carry a shorter note */
export const NOTE_MAX_LENGTH = 80;

/* Rate limits. Game effects: at least EFFECT_WINDOW_MS between two on a ride (whoever pays first; keeps a ride drivable) – a SLIDING window, checked
   under a per-ride advisory lock in the repository. Chat lines / tips: one per wallet per LINE_WINDOW_MS bucket of server time – the unique key
   (rideId, slotKey, slot) of live.RideEvent refuses a second row in the bucket, no lock (spam control; two lines may land a moment apart across a bucket edge). */
export const EFFECT_WINDOW_MS = 20_000;
export const LINE_WINDOW_MS = 3_000;

/** pages: events per poll, recording batches per poll (≈ 15 s each, so 20 ≈ 5 min of replay) */
export const FEED_PAGE = 100;
export const WATCH_BATCH_PAGE = 20;
/** a spectator counts as watching for this long after its last poll */
export const VIEWER_WINDOW_MS = 20_000;
/** viewer ids per source (client IP) that count – a script inventing ids cannot inflate "N watching" beyond this per address */
export const VIEWERS_PER_SOURCE = 3;
/** what an applied stamp may claim: on the road, within the recording's limits */
export const APPLIED_MAX_S = 1e7;
export const APPLIED_MAX_LAT = 40;
