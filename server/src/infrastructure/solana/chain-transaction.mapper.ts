import { PublicKey, SystemProgram, type ParsedTransactionWithMeta } from '@solana/web3.js';
import type { ChainTransaction, ChainTransfer } from '../../domain/economy/chain-transaction.js';

export const MEMO_PROGRAM = new PublicKey('MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr');

/** The RPC's parsed transaction → the chain-agnostic view payment verification needs. Reads every top-level instruction (wallets may add compute-budget etc.). */
export function toChainTransaction(tx: ParsedTransactionWithMeta): ChainTransaction {
  const outcome = !tx.meta ? 'no_metadata' : tx.meta.err ? 'failed' : 'success';
  const payer = tx.transaction.message.accountKeys[0];
  const transfers: ChainTransfer[] = [];
  const memos: string[] = [];
  for (const ix of tx.transaction.message.instructions) {
    if (!('parsed' in ix)) continue;
    if (ix.programId.equals(SystemProgram.programId) && ix.parsed?.type === 'transfer') {
      const info = ix.parsed.info as { source?: string; destination?: string; lamports?: number | string };
      transfers.push({ source: String(info.source), destination: String(info.destination), lamports: Number(info.lamports) });
    } else if (ix.programId.equals(MEMO_PROGRAM) && typeof ix.parsed === 'string') {
      memos.push(ix.parsed);
    }
  }
  return { outcome, feePayer: payer?.pubkey.toBase58() ?? null, feePayerSigned: payer?.signer ?? false, transfers, memos };
}
