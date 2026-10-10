import { ComputeBudgetProgram, Transaction, VersionedTransaction, type Commitment, type Keypair, type TransactionInstruction } from '@solana/web3.js';
import bs58 from 'bs58';
import { ConflictError } from '../../domain/shared/errors.js';
import type { SolanaRpc } from './solana-rpc.js';

/* Transactions the server signs with ITS OWN keys (the crank, the payout key) and sends itself: sign → simulate → (persist the signature) → re-send every 2 s
   until confirmed or the blockhash is gone – the usual pattern under congestion. Shared by ProgramCrankAdapter and ProgramPayoutAdapter. */

const RESEND_MS = 2_000;
const MAX_RESENDS = 60;

export interface SignedTx {
  raw: Buffer;
  signature: string;
  lastValidBlockHeight: number;
}

/** compute budget + the program instructions, paid and signed by `payer` */
export async function signWith(rpc: SolanaRpc, commitment: Commitment, payer: Keypair, ixs: TransactionInstruction[], units: number, priorityMicrolamports: number): Promise<SignedTx> {
  const { blockhash, lastValidBlockHeight } = await rpc.read((x) => x.getLatestBlockhash(commitment));
  const tx = new Transaction({ feePayer: payer.publicKey, blockhash, lastValidBlockHeight })
    .add(ComputeBudgetProgram.setComputeUnitLimit({ units }), ComputeBudgetProgram.setComputeUnitPrice({ microLamports: priorityMicrolamports }), ...ixs);
  tx.sign(payer);
  return { raw: tx.serialize(), signature: bs58.encode(tx.signature!), lastValidBlockHeight };
}

/** a dry run with signatures checked; ConflictError `transaction_would_fail` naming the program's last log line */
export async function simulateSigned(rpc: SolanaRpc, commitment: Commitment, tx: SignedTx, label: string): Promise<void> {
  const sim = await rpc.read((x) => x.simulateTransaction(VersionedTransaction.deserialize(tx.raw), { sigVerify: true, commitment }));
  if (sim.value.err) throw new ConflictError(`${label} would fail: ${JSON.stringify(sim.value.err)} – ${sim.value.logs?.at(-1) ?? ''}`, 'transaction_would_fail');
}

/** re-send until confirmed (at `commitment`); ConflictError `transaction_failed` / `transaction_dropped` (the blockhash expired – it will never land) / `transaction_unconfirmed` */
export async function broadcastUntilConfirmed(rpc: SolanaRpc, commitment: Commitment, tx: SignedTx, label: string, wait: (ms: number) => Promise<void>, debug: (m: string) => void): Promise<void> {
  for (let n = 0; n < MAX_RESENDS; n++) {
    await rpc.primaryOnly((x) => x.sendRawTransaction(tx.raw, { skipPreflight: true, maxRetries: 0 })).catch((e: unknown) => debug(`re-send: ${(e as Error).message}`));
    await wait(RESEND_MS);
    const s = await rpc.primaryOnly(async (x) => (await x.getSignatureStatuses([tx.signature], { searchTransactionHistory: true })).value[0]);
    if (s?.err) throw new ConflictError(`${label} failed on chain: ${JSON.stringify(s.err)}`, 'transaction_failed');
    if (s?.confirmationStatus === 'finalized' || (s?.confirmationStatus === 'confirmed' && commitment === 'confirmed')) return;
    if (!s && (await rpc.primaryOnly((x) => x.getBlockHeight(commitment))) > tx.lastValidBlockHeight) {
      throw new ConflictError(`${label} was dropped – the next pass sends it again`, 'transaction_dropped');
    }
  }
  throw new ConflictError(`${label} (${tx.signature}) is not confirmed yet – the watcher settles it when it lands`, 'transaction_unconfirmed');
}
