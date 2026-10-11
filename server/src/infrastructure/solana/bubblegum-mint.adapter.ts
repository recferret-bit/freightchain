import { Injectable, Logger } from '@nestjs/common';
import { Connection, type Keypair } from '@solana/web3.js';
import bs58 from 'bs58';
import { mintV2, mplBubblegum, parseLeafFromMintV2Transaction } from '@metaplex-foundation/mpl-bubblegum';
import { setComputeUnitLimit, setComputeUnitPrice } from '@metaplex-foundation/mpl-toolbox';
import { createUmi } from '@metaplex-foundation/umi-bundle-defaults';
import { createSignerFromKeypair, keypairIdentity, publicKey, some, type Umi } from '@metaplex-foundation/umi';
import { NFT_METADATA_URIS } from '../../domain/achievements/nft-metadata-uris.js';
import { ServiceUnavailableError } from '../../domain/shared/errors.js';
import { AchievementMintChainPort, type MintSignatureStatus, type SignedMint } from '../../application/ports/achievements/achievement-mint-chain.port.js';
import { EnvService } from '../config/env.service.js';
import { parseKeypair } from './program-chain.adapter.js';
import { broadcastUntilConfirmed, simulateSigned, type SignedTx } from './signed-sender.js';
import { SolanaRpc, sleep } from './solana-rpc.js';

/** compressed leaf append + collection CPI: ~120-200k units at depth 14-20 */
const MINT_CU = 400_000;

/**
 * Soulbound badge cNFTs (docs/agents/achievements.md): Bubblegum v2 `mintV2` into an MPL-Core collection that carries the PermanentFreezeDelegate plugin
 * (frozen = non-transferable) and the BubblegumV2 plugin. The achievement key is the tree creator AND the collection authority and pays the fees; the leaf
 * owner is the player's wallet. Signed and sent through signed-sender.ts, like the crank and the payout key – the signature is handed out BEFORE it is broadcast.
 * Never connects at construction (the app boots without the keys).
 */
@Injectable()
export class BubblegumMintAdapter extends AchievementMintChainPort {
  private readonly logger = new Logger(BubblegumMintAdapter.name);
  private readonly rpc: SolanaRpc;
  private readonly key: Keypair | null;
  private umiCache: Umi | null = null;
  /** overridable in specs */
  protected wait: (ms: number) => Promise<void> = sleep;

  constructor(private readonly env: EnvService) {
    super();
    this.rpc = new SolanaRpc(new Connection(env.solanaRpc, { commitment: env.solanaCommitment }), env.solanaRpcFallbacks.map((u) => new Connection(u, { commitment: env.solanaCommitment })), (ms) => this.wait(ms));
    this.key = env.achievementMintSecret && env.achievementTree && env.achievementCollection ? parseKeypair(env.achievementMintSecret) : null; // a malformed key stops the boot, like any invalid env
  }

  get address(): string | null { return this.key?.publicKey.toBase58() ?? null; }

  metadataUri(achievementId: string): string | null { return NFT_METADATA_URIS[achievementId] ?? null; }

  private get umi(): Umi {
    if (!this.key) throw new ServiceUnavailableError('achievement minting is not configured (ACHIEVEMENT_MINT_SECRET, ACHIEVEMENT_TREE, ACHIEVEMENT_COLLECTION)');
    if (!this.umiCache) {
      const umi = createUmi(this.env.solanaRpc, { commitment: this.env.solanaCommitment }).use(mplBubblegum());
      this.umiCache = umi.use(keypairIdentity(createSignerFromKeypair(umi, umi.eddsa.createKeypairFromSecretKey(this.key.secretKey))));
    }
    return this.umiCache;
  }

  async mint(i: { wallet: string; name: string; uri: string }, onSigned: (tx: SignedMint) => Promise<void>): Promise<{ signature: string }> {
    const umi = this.umi, tree = publicKey(this.env.achievementTree!), collection = publicKey(this.env.achievementCollection!);
    const builder = setComputeUnitLimit(umi, { units: MINT_CU })
      .add(setComputeUnitPrice(umi, { microLamports: this.env.priorityFee.minMicrolamports }))
      .add(mintV2(umi, {
        leafOwner: publicKey(i.wallet), merkleTree: tree, coreCollection: collection, collectionAuthority: umi.identity,
        metadata: { name: i.name, uri: i.uri, sellerFeeBasisPoints: 0, collection: some(collection), creators: [] },
      }));
    const latest = await this.rpc.read(async () => umi.rpc.getLatestBlockhash({ commitment: this.env.solanaCommitment }));
    const signed = await builder.setBlockhash(latest).buildAndSign(umi);
    const tx: SignedTx = {
      raw: Buffer.from(umi.transactions.serialize(signed)),
      signature: bs58.encode(signed.signatures[0]!),
      lastValidBlockHeight: latest.lastValidBlockHeight,
    };
    const label = `mint ${i.name} to ${i.wallet}`;
    await simulateSigned(this.rpc, this.env.solanaCommitment, tx, label);
    await onSigned({ signature: tx.signature, lastValidBlockHeight: tx.lastValidBlockHeight });
    await broadcastUntilConfirmed(this.rpc, this.env.solanaCommitment, tx, label, (ms) => this.wait(ms), (m) => this.logger.debug(m));
    return { signature: tx.signature };
  }

  async signatureStatus(signature: string, lastValidBlockHeight: number): Promise<MintSignatureStatus> {
    const s = await this.rpc.primaryOnly(async (x) => (await x.getSignatureStatuses([signature], { searchTransactionHistory: true })).value[0]);
    if (s?.err) return 'failed';
    if (s?.confirmationStatus === 'finalized') return 'finalized';
    if (s?.confirmationStatus === 'confirmed' || s?.confirmationStatus === 'processed') return s.confirmationStatus === 'processed' ? 'pending' : 'confirmed';
    return lastValidBlockHeight > 0 && (await this.rpc.primaryOnly((x) => x.getBlockHeight(this.env.solanaCommitment))) > lastValidBlockHeight ? 'expired' : 'pending';
  }

  async assetIdOf(signature: string): Promise<string | null> {
    try {
      return (await parseLeafFromMintV2Transaction(this.umi, bs58.decode(signature))).id;
    } catch (e) {
      this.logger.debug(`asset id of ${signature}: ${(e as Error).message}`);
      return null;
    }
  }
}
