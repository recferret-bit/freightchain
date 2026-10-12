import { AchievementMintChainPort, type MintSignatureStatus, type SignedMint } from '../../src/application/ports/achievements/achievement-mint-chain.port.js';
import { ServiceUnavailableError } from '../../src/domain/shared/errors.js';

/** The badge tree without a chain: every mint gets a signature (handed to `onSigned` BEFORE it "lands"), statuses and asset ids are set by the test. */
export class FakeMintChain extends AchievementMintChainPort {
  address: string | null = 'Minter1111111111111111111111111111111111111';
  /** ids with an uploaded metadata JSON; every id by default */
  uris: Record<string, string> | null = null;
  readonly minted: { wallet: string; name: string; uri: string; signature: string }[] = [];
  readonly statuses = new Map<string, MintSignatureStatus>();
  readonly assets = new Map<string, string>();
  /** make the next mint throw after signing (`onSigned` already ran) or before (`before`) */
  failNext: { error: Error; before: boolean } | null = null;
  /** what the tree reports (null = unknown) */
  usage: { minted: number; capacity: number } | null = { minted: 0, capacity: 65_536 };
  /** an asset id is not parseable yet */
  assetPending = false;
  private n = 0;

  metadataUri(id: string): string | null { return this.uris ? (this.uris[id] ?? null) : `https://arweave.net/${id}`; }

  async mint(i: { wallet: string; name: string; uri: string }, onSigned: (tx: SignedMint) => Promise<void>): Promise<{ signature: string }> {
    if (!this.address) throw new ServiceUnavailableError('no key');
    const fail = this.failNext;
    if (fail?.before) { this.failNext = null; throw fail.error; }
    const signature = `sig${++this.n}`;
    await onSigned({ signature, lastValidBlockHeight: 1_000 + this.n });
    if (fail) { this.failNext = null; throw fail.error; }
    this.minted.push({ ...i, signature });
    this.statuses.set(signature, 'confirmed');
    if (!this.assetPending) this.assets.set(signature, `asset-${signature}`);
    return { signature };
  }

  async treeUsage() { return this.usage; }
  async signatureStatus(signature: string): Promise<MintSignatureStatus> { return this.statuses.get(signature) ?? 'pending'; }
  async assetIdOf(signature: string): Promise<string | null> { return this.assets.get(signature) ?? null; }
}
