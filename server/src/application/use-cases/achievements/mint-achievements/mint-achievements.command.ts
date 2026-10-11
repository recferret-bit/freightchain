/** One mint pass (ACHIEVEMENT_MINT_SECRET + tree + collection): queue the unlocks that waited long enough, resolve the transactions in flight, mint the planned ones. */
export class MintAchievementsCommand {
  constructor(
    /** an unlock is queued only when it is at least this old (ms) */
    readonly delayMs: number,
    /** transactions sent this pass */
    readonly batch: number,
    /** failed rows go back to planned first (admin retry) */
    readonly retry: boolean = false,
  ) {}
}

export interface MintPassDto {
  /** false = no key / tree / collection configured */
  enabled: boolean;
  minter: string | null;
  queued: number;
  minted: number;
  skipped: number;
  /** transactions in flight or waiting for the next pass */
  waiting: number;
  failed: number;
  retried: number;
  /** the tree's fill (null = unknown); a full tree sends nothing */
  tree: { minted: number; capacity: number } | null;
}
