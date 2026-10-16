import type { LiveFlags } from '../../../domain/live/live-features.js';
export interface RulesConfig {
  /** Not the live signup grant. New wallets take `free_on_signup` from `player.GameSetting`. Kept so older fixtures still type-check; session does not read it. */
  freeOnSignup: number;
  /** Not the live daily cap. That is `free_rides_daily_max`. Kept so older fixtures still type-check; session does not read it. */
  freeRidesMax: number;
  freeRideSeconds: number;
  hbMinIntervalMs: number;
  hbTimeoutMs: number;
  /** how long a paid order's price is held */
  quoteTtlMs: number;
  nonceTtlMs: number;
  /** wallets whose PAID rides are shortened for demos ('*' = everyone) */
  demoWallets: ReadonlySet<string>;
  demoScale: number;
  /** lamports the very first round starts with */
  initialSeedLamports: number;
  /** where entry fees go ('' = paid rides are disabled) */
  treasury: string;
  appDomain: string;
  appOrigin: string;
  /** false in production. When true, a sign-in from localhost / *.localhost names that page (Phantom drops any other domain with no window). */
  localSignIn: boolean;
  /** split deployment: the game host (ride.<apex>) – a sign-in requested from there names it in the message, so the wallet sees its own page's domain */
  gameDomain: string | null;
  gameOrigin: string | null;
  /** 'program' = escrow pools via the Anchor program; 'transfer' = plain transfers to the treasuries (fallback) */
  paymentMode: 'program' | 'transfer';
  /** the deployed pool program ('' = none) */
  programId: string;
  /** defaults for new pools' treasury variables ('' = unset) */
  feeTreasury: string;
  seedTreasury: string;
  /** program-log poll interval, 0 = the watcher is off */
  watchIntervalMs: number;
  /** a paid-ticket order lapses after this long unpaid (the price is on the pool, so there is no quote to expire) */
  orderTtlMs: number;
  /** credit tickets at 'confirmed'; 'finalized' also gates rides on finality (mainnet) */
  commitment: 'confirmed' | 'finalized';
  /** the badge cNFT collection + tree (the profile links them in the explorer); unset = minting is not configured */
  achievementCollection?: string;
  achievementTree?: string;
  /** is a crank key configured? (the key itself stays in EnvService) */
  crankEnabled: boolean;
  priorityFee: { percentile: number; minMicrolamports: number; maxMicrolamports: number };
  /** how long an on-chain session key is valid (hours) */
  sessionTtlHours: number;
  /** false = SHADOW mode: verdicts are judged and shown, but the paid boards rank every completed shift */
  verdictEnforce: boolean;
  trafficProofRequired?: boolean;
  /** recordings of rides that ended longer ago are deleted (flagged rides excepted); 0 = keep forever */
  telemetryRetentionDays: number;
  /** sign-in rows (wallet, time, IP, browser) older than this are deleted; 0 = keep forever */
  signInRetentionDays: number;
  /** verified play: seconds of driving between two dispatch prompts (a short shift gets at most 4); 0 = no prompts */
  challengeIntervalSeconds: number;
  /** dispatch prompts on FREE rides too (CHALLENGE_FREE_RIDES; production: off) */
  challengeFreeRides: boolean;
  /** live streams' feature flags (LIVE_CHAT / LIVE_DONATIONS / LIVE_FREE_DONATIONS / LIVE_EFFECTS) */
  live: LiveFlags;
  /** wallets that may sign in to the admin page (empty = nobody) */
  adminWallets: ReadonlySet<string>;
  /** where the admin page lives – named in the admin sign-in message so the wallet can match it to the page (admin.<apex>; the app's own domain on a single origin) */
  adminDomain: string;
  adminOrigin: string;
  /** wallets that may sign in to the 3D model editor (EDITOR_WALLETS; empty = nobody) */
  editorWallets: ReadonlySet<string>;
  /** where the editor lives – named in its sign-in and publish messages (storybook.<apex>; the app's own domain on a single origin) */
  editorDomain: string;
  editorOrigin: string;
  /** an AI editor job running longer is aborted (EDITOR_JOB_TIMEOUT_MS) */
  editorJobTimeoutMs: number;
}

/** Game and economy tunables (environment-backed in production). */
export abstract class RulesConfigPort {
  abstract get(): RulesConfig;
}
