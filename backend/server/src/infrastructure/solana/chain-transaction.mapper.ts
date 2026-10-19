import { PublicKey, SystemProgram, TransactionInstruction, type ParsedInstruction, type ParsedTransactionWithMeta, type PartiallyDecodedInstruction } from '@solana/web3.js';
import bs58 from 'bs58';
import type { ChainTransaction, ChainTransfer } from '../../domain/economy/chain-transaction.js';

export const MEMO_PROGRAM = new PublicKey('MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr');

/** Memo instruction. Every account handed to the memo program must SIGN (it fails with "missing required signature" otherwise) – so no reference here. */
export function memoInstruction(memo: string, signers: PublicKey[]): TransactionInstruction {
  return new TransactionInstruction({ keys: signers.map((pubkey) => ({ pubkey, isSigner: true, isWritable: false })), programId: MEMO_PROGRAM, data: Buffer.from(memo) });
}

/** Solana Pay's reference: a read-only non-signer key appended to the PAYMENT instruction itself (the System transfer ignores extra accounts; for an Anchor
    instruction it is a remaining account), so getSignaturesForAddress(reference) finds the payment. Returns the same instruction. */
export function withReference(ix: TransactionInstruction, reference?: string | null): TransactionInstruction {
  if (reference) ix.keys.push({ pubkey: new PublicKey(reference), isSigner: false, isWritable: false });
  return ix;
}

/** Memo text. A reference account makes some RPCs leave the instruction unparsed (`data` is base58); the payment still has to match. */
function memoText(ix: ParsedInstruction | PartiallyDecodedInstruction): string | null {
  if (!ix.programId.equals(MEMO_PROGRAM)) return null;
  if ('parsed' in ix) {
    if (typeof ix.parsed === 'string') return ix.parsed;
    const info = (ix.parsed as { info?: unknown } | null)?.info;
    return typeof info === 'string' ? info : null;
  }
  try { return Buffer.from(bs58.decode(ix.data)).toString('utf8'); } catch { return null; }
}

/** The RPC's parsed transaction → the chain-agnostic view payment verification needs. Reads every top-level instruction (wallets may add compute-budget etc.). */
export function toChainTransaction(tx: ParsedTransactionWithMeta): ChainTransaction {
  const outcome = !tx.meta ? 'no_metadata' : tx.meta.err ? 'failed' : 'success';
  const payer = tx.transaction.message.accountKeys[0];
  const transfers: ChainTransfer[] = [];
  const memos: string[] = [];
  for (const ix of tx.transaction.message.instructions) {
    if ('parsed' in ix && ix.programId.equals(SystemProgram.programId) && ix.parsed?.type === 'transfer') {
      const info = ix.parsed.info as { source?: string; destination?: string; lamports?: number | string };
      transfers.push({ source: String(info.source), destination: String(info.destination), lamports: Number(info.lamports) });
    }
    const memo = memoText(ix);
    if (memo !== null) memos.push(memo);
  }
  return {
    outcome, feePayer: payer?.pubkey.toBase58() ?? null, feePayerSigned: payer?.signer ?? false, transfers, memos,
    accountKeys: tx.transaction.message.accountKeys.map((k) => (typeof k.pubkey === 'string' ? k.pubkey : k.pubkey.toBase58())),
  };
}
