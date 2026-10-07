import { Keypair, PublicKey, SystemProgram, Transaction, TransactionInstruction } from '@solana/web3.js';
import bs58 from 'bs58';
import { randomBytes } from 'node:crypto';
import type { ChainSignature, ChainTransaction, UnsignedPaymentTx } from '../../src/domain/economy/chain-transaction.js';
import { ChainPort, type PaymentTxInput } from '../../src/application/ports/economy/chain.port.js';
import { MEMO_PROGRAM } from '../../src/infrastructure/solana/chain-transaction.mapper.js';

export const TREASURY = Keypair.generate().publicKey.toBase58();
export const newSignature = (): string => bs58.encode(randomBytes(64));

export interface PaymentOptions {
  payer: string;
  lamports?: number;
  /** null = no memo at all */
  memo?: string | null;
  destination?: string;
  source?: string;
  outcome?: ChainTransaction['outcome'];
  /** extra transfers / memos around the payment (wallets add compute-budget etc.) */
  extraTransfers?: ChainTransaction['transfers'];
  feePayer?: string;
}

/** The Solana network as a test double: transactions we craft, a per-wallet history with the RPC's own memo rendering. */
export class FakeChain extends ChainPort {
  readonly txs = new Map<string, ChainTransaction>();
  readonly history = new Map<string, ChainSignature[]>();
  /** how many transactions were fetched in full */
  fetched = 0;

  reset(): void { this.txs.clear(); this.history.clear(); this.fetched = 0; }

  async buildPaymentTransaction(input: PaymentTxInput): Promise<UnsignedPaymentTx> {
    const blockhash = Keypair.generate().publicKey.toBase58();
    const payer = new PublicKey(input.payer);
    const tx = new Transaction({ feePayer: payer, recentBlockhash: blockhash })
      .add(SystemProgram.transfer({ fromPubkey: payer, toPubkey: new PublicKey(input.treasury), lamports: input.lamports }))
      .add(new TransactionInstruction({ keys: [{ pubkey: payer, isSigner: true, isWritable: false }], programId: MEMO_PROGRAM, data: Buffer.from(input.memo) }));
    return { blockhash, lastValidBlockHeight: 1, transaction: tx.serialize({ requireAllSignatures: false, verifySignatures: false }).toString('base64') };
  }

  async getTransaction(signature: string): Promise<ChainTransaction | null> {
    this.fetched++;
    return this.txs.get(signature) ?? null;
  }

  async recentSignatures(wallet: string, limit: number): Promise<ChainSignature[]> {
    return [...(this.history.get(wallet) ?? [])].reverse().slice(0, limit); // newest first, like getSignaturesForAddress
  }

  /** Put a payment on the chain (visible to getTransaction AND in the payer's history). Returns its signature. */
  addPayment(o: PaymentOptions): string {
    const signature = newSignature();
    const memo = o.memo === undefined ? null : o.memo;
    this.txs.set(signature, {
      outcome: o.outcome ?? 'success', feePayer: o.feePayer ?? o.payer, feePayerSigned: true,
      transfers: [...(o.extraTransfers ?? []), { source: o.source ?? o.payer, destination: o.destination ?? TREASURY, lamports: o.lamports ?? 0 }],
      memos: memo === null ? [] : [memo],
    });
    this.addHistory(o.payer, signature, memo);
    return signature;
  }

  addHistory(wallet: string, signature: string, memo: string | null): void {
    this.history.set(wallet, [...(this.history.get(wallet) ?? []), { signature, memo: memo === null ? null : `[${memo.length}] ${memo}` }]);
  }
}
