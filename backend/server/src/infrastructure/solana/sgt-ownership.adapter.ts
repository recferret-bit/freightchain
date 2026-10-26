import { Injectable } from '@nestjs/common';
import { PublicKey, type AccountInfo } from '@solana/web3.js';
import { TOKEN_2022_PROGRAM_ID, unpackAccount, unpackMint, getMetadataPointerState, getTokenGroupMemberState } from '@solana/spl-token';
import { z } from 'zod';
import { SgtOwnershipPort, type SgtProof } from '../../application/trust/sgt.port.js';
import { ServiceUnavailableError } from '../../domain/shared/errors.js';
import { EnvService } from '../config/env.service.js';

// Solana Mobile's canonical mainnet group; neither the caller nor RPC configuration chooses it.
export const SGT_GROUP = 'GT22s89nU4iWFkNXj1Bw6uYhJJWDRPpShHt4Bk8f99Te';
export const MAINNET_GENESIS = '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d';
const rawAccount = z.object({ owner: z.string(), data: z.tuple([z.string(), z.literal('base64')]), executable: z.boolean(), lamports: z.number(), rentEpoch: z.number().optional() });
const context = z.object({ slot: z.number().int().nonnegative().max(2_147_483_647) });
type RawAccount = z.infer<typeof rawAccount>;
const decode = (a: RawAccount): AccountInfo<Buffer> => ({ ...a, owner: new PublicKey(a.owner), data: Buffer.from(a.data[0], 'base64') });

@Injectable()
export class SgtOwnershipAdapter extends SgtOwnershipPort {
  constructor(private readonly env: EnvService) { super(); }
  enabled(): boolean { return !!this.env.sgtRpcUrl; }
  async verify(wallet: string): Promise<SgtProof[]> {
    if (!this.enabled()) throw new ServiceUnavailableError('Seeker verification is not configured', 'sgt_unconfigured');
    try {
      const signal = AbortSignal.timeout(10_000), owner = new PublicKey(wallet);
      if (await this.rpc('getGenesisHash', [], signal) !== MAINNET_GENESIS) throw new Error('wrong cluster');
      const accounts = z.object({ context, value: z.array(z.object({ pubkey: z.string(), account: rawAccount })).max(1000) }).parse(await this.rpc('getTokenAccountsByOwner', [wallet, { programId: TOKEN_2022_PROGRAM_ID.toBase58() }, { encoding: 'base64', commitment: 'finalized' }], signal));
      const candidates: { account: PublicKey; mint: PublicKey }[] = [];
      for (const entry of accounts.value) {
        try {
          const address = new PublicKey(entry.pubkey), token = unpackAccount(address, decode(entry.account), TOKEN_2022_PROGRAM_ID);
          if (token.owner.equals(owner) && token.amount === 1n && token.isInitialized) candidates.push({ account: address, mint: token.mint });
        } catch { /* A counterfeit/non-token account provides no ownership evidence. */ }
      }
      const proofs = new Map<string, SgtProof>();
      for (let i = 0; i < candidates.length; i += 50) {
        const batch = candidates.slice(i, i + 50);
        // Re-read each token together with its mint in one bank; discovery alone can be stale after a transfer.
        const result = z.object({ context, value: z.array(rawAccount.nullable()) }).parse(await this.rpc('getMultipleAccounts', [batch.flatMap(x => [x.account.toBase58(), x.mint.toBase58()]), { encoding: 'base64', commitment: 'finalized', minContextSlot: accounts.context.slot }], signal));
        if (result.context.slot < accounts.context.slot || result.value.length !== batch.length * 2) throw new Error('incomplete snapshot');
        for (let n = 0; n < batch.length; n++) {
          const tokenInfo = result.value[n * 2], mintInfo = result.value[n * 2 + 1], candidate = batch[n];
          if (!tokenInfo || !mintInfo) continue;
          try {
            const token = unpackAccount(candidate.account, decode(tokenInfo), TOKEN_2022_PROGRAM_ID);
            const mint = unpackMint(candidate.mint, decode(mintInfo), TOKEN_2022_PROGRAM_ID);
            const metadata = getMetadataPointerState(mint), member = getTokenGroupMemberState(mint);
            if (token.owner.equals(owner) && token.mint.equals(candidate.mint) && token.amount === 1n && token.isInitialized && mint.isInitialized && mint.decimals === 0 && mint.supply === 1n && member?.mint?.equals(candidate.mint) && member.group?.toBase58() === SGT_GROUP && metadata?.metadataAddress?.toBase58() === SGT_GROUP) {
              proofs.set(candidate.mint.toBase58(), { mint: candidate.mint.toBase58(), slot: result.context.slot });
            }
          } catch { /* Missing or malformed Token-2022 extensions cannot qualify. Frozen accounts do qualify. */ }
        }
      }
      return [...proofs.values()].sort((a, b) => a.mint.localeCompare(b.mint));
    } catch {
      // Never leak credential-bearing RPC URLs or turn an outage into "not held".
      throw new ServiceUnavailableError('Seeker ownership verification is temporarily unavailable', 'sgt_unavailable');
    }
  }
  private async rpc(method: string, params: unknown[], signal: AbortSignal): Promise<unknown> {
    const response = await fetch(this.env.sgtRpcUrl!, { method: 'POST', redirect: 'error', signal, headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) });
    if (!response.ok) throw new Error('RPC unavailable');
    const body = z.object({ result: z.unknown(), error: z.unknown().optional() }).parse(await response.json());
    if (body.error || body.result === undefined) throw new Error('RPC refused');
    return body.result;
  }
}
