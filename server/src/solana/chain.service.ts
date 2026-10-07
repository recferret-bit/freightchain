import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { Connection, PublicKey, type ParsedTransactionWithMeta } from '@solana/web3.js';
import { config } from '../config.js';

/* The only module that talks to a Solana RPC (a provider, so tests swap it for a fake). */
@Injectable()
export class ChainService {
  private readonly conn = new Connection(config.solRpc, 'confirmed');

  async latestBlockhash(): Promise<{ blockhash: string; lastValidBlockHeight: number }> {
    try { return await this.conn.getLatestBlockhash('confirmed'); } catch { throw new ServiceUnavailableException('Solana RPC unavailable'); }
  }

  /** null = not found at `confirmed` yet (retry); an RPC failure is a 503, never "not found". */
  async parsedTx(signature: string): Promise<ParsedTransactionWithMeta | null> {
    try { return await this.conn.getParsedTransaction(signature, { commitment: 'confirmed', maxSupportedTransactionVersion: 0 }); } catch { throw new ServiceUnavailableException('Solana RPC unavailable'); }
  }

  /** newest-first listing of the wallet's recent successful transactions. `memo` is the RPC's own rendering – "[<len>] <text>", several memos joined by "; " –
      so callers can pick candidates WITHOUT fetching each transaction (the public RPC is rate-limited). */
  async recentSignatures(address: string, limit = 25): Promise<{ signature: string; memo: string | null }[]> {
    try { return (await this.conn.getSignaturesForAddress(new PublicKey(address), { limit }, 'confirmed')).filter(x => !x.err).map(x => ({ signature: x.signature, memo: x.memo })); } catch { throw new ServiceUnavailableException('Solana RPC unavailable'); }
  }
}
