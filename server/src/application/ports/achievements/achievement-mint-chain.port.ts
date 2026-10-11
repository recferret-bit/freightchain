export interface SignedMint {
  signature: string;
  lastValidBlockHeight: number;
}

export type MintSignatureStatus = 'pending' | 'confirmed' | 'finalized' | 'failed' | 'expired';

/** The badge tree on chain: soulbound compressed NFTs (Bubblegum v2, an MPL-Core collection) minted by the achievement key. */
export abstract class AchievementMintChainPort {
  /** the achievement key's address; null = minting is not configured (no key, tree or collection) */
  abstract get address(): string | null;
  /** the on-chain metadata URI of an achievement's JSON; null = not uploaded yet (such a badge is not minted) */
  abstract metadataUri(achievementId: string): string | null;
  /** Signs the mint (leaf owner = `wallet`), hands the signature to `onSigned` BEFORE broadcasting, then broadcasts until confirmed. */
  abstract mint(i: { wallet: string; name: string; uri: string }, onSigned: (tx: SignedMint) => Promise<void>): Promise<{ signature: string }>;
  /** a transaction that landed WITH an error is `failed`; one whose blockhash is gone and never landed is `expired` */
  abstract signatureStatus(signature: string, lastValidBlockHeight: number): Promise<MintSignatureStatus>;
  /** how full the tree is (minted / capacity); null = unknown (not configured, or the RPC cannot read it) */
  abstract treeUsage(): Promise<{ minted: number; capacity: number } | null>;
  /** the cNFT's asset id from a landed mint transaction; null = the RPC cannot parse it (yet) */
  abstract assetIdOf(signature: string): Promise<string | null>;
}
