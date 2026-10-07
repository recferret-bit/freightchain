export interface RulesConfig {
  /** free rides granted at registration */
  freeOnSignup: number;
  /** the cap on a wallet's free-ride credits (stored per player; this is the value new wallets start with) */
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
  /** false = SHADOW mode: verdicts are judged and shown, but the paid boards rank every completed shift */
  verdictEnforce: boolean;
  /** recordings of rides that ended longer ago are deleted (flagged rides excepted); 0 = keep forever */
  telemetryRetentionDays: number;
}

/** Game and economy tunables (environment-backed in production). */
export abstract class RulesConfigPort {
  abstract get(): RulesConfig;
}
