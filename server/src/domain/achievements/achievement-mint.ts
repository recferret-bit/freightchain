/* The mint outbox of an unlock: planned → sent (signed transaction stored BEFORE it is broadcast) → minted (asset id known). skipped / failed keep the reason. */
export type MintStatus = 'planned' | 'sent' | 'minted' | 'failed' | 'skipped';

export interface AchievementMintRecord {
  wallet: string;
  achievementId: string;
  status: MintStatus;
  signature: string | null;
  lastValidBlockHeight: number | null;
  assetId: string | null;
  attempts: number;
  error: string | null;
}

/** transactions sent for one unlock before the row stays `failed` (an admin looks at it: `achievement:mint --retry`) */
export const MAX_MINT_ATTEMPTS = 5;
export const SKIP_DEMO_WALLET = 'demo-wallet';
export const SKIP_NO_LONGER_EARNED = 'no-longer-earned';

/** the on-chain symbol of every badge */
export const NFT_SYMBOL = 'FCHAIN';
