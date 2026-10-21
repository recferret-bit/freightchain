import { Keypair, PublicKey, SystemProgram, Transaction } from '@solana/web3.js';
import bs58 from 'bs58';
import { randomBytes } from 'node:crypto';
import type { ChainSignature, ChainTransaction, UnsignedPaymentTx } from '../../src/domain/economy/chain-transaction.js';
import { ChainPort, type PaymentTxInput } from '../../src/application/ports/economy/chain.port.js';
import { memoInstruction, withReference } from '../../src/infrastructure/solana/chain-transaction.mapper.js';

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
  /** put on accountKeys and indexed for signaturesForAddress */
  reference?: string;
}

/** The Solana network as a test double: transactions we craft, a per-wallet history with the RPC's own memo rendering. */
export class FakeChain extends ChainPort {
  readonly txs = new Map<string, ChainTransaction>();
  readonly history = new Map<string, ChainSignature[]>();
  readonly mentioned = new Map<string, ChainSignature[]>();
  /** how many transactions were fetched in full */
  fetched = 0;

  reset(): void { this.txs.clear(); this.history.clear(); this.mentioned.clear(); this.fetched = 0; }

  async buildPaymentTransaction(input: PaymentTxInput): Promise<UnsignedPaymentTx> {
    const blockhash = Keypair.generate().publicKey.toBase58();
    const payer = new PublicKey(input.payer);
    const tx = new Transaction({ feePayer: payer, recentBlockhash: blockhash })
      .add(withReference(SystemProgram.transfer({ fromPubkey: payer, toPubkey: new PublicKey(input.treasury), lamports: input.lamports }), input.reference));
    for (const extra of input.also ?? []) tx.add(SystemProgram.transfer({ fromPubkey: payer, toPubkey: new PublicKey(extra.to), lamports: extra.lamports }));
    tx.add(memoInstruction(input.memo, [payer]));
    return { blockhash, lastValidBlockHeight: 1, transaction: tx.serialize({ requireAllSignatures: false, verifySignatures: false }).toString('base64') };
  }

  async getTransaction(signature: string): Promise<ChainTransaction | null> {
    this.fetched++;
    return this.txs.get(signature) ?? null;
  }

  async recentSignatures(wallet: string, limit: number): Promise<ChainSignature[]> {
    return [...(this.history.get(wallet) ?? [])].reverse().slice(0, limit); // newest first, like getSignaturesForAddress
  }

  async signaturesForAddress(address: string, limit: number): Promise<ChainSignature[]> {
    return [...(this.mentioned.get(address) ?? [])].reverse().slice(0, limit);
  }

  /** Put a payment on the chain (visible to getTransaction AND in the payer's history). Returns its signature. */
  addPayment(o: PaymentOptions): string {
    const signature = newSignature();
    const memo = o.memo === undefined ? null : o.memo;
    const destination = o.destination ?? TREASURY;
    const source = o.source ?? o.payer;
    this.txs.set(signature, {
      outcome: o.outcome ?? 'success', feePayer: o.feePayer ?? o.payer, feePayerSigned: true,
      transfers: [...(o.extraTransfers ?? []), { source, destination, lamports: o.lamports ?? 0 }],
      memos: memo === null ? [] : [memo],
      accountKeys: [o.feePayer ?? o.payer, source, destination, ...(o.reference ? [o.reference] : [])],
    });
    this.addHistory(o.payer, signature, memo);
    if (o.reference) this.mention(o.reference, signature, memo);
    return signature;
  }

  addHistory(wallet: string, signature: string, memo: string | null): void {
    this.history.set(wallet, [...(this.history.get(wallet) ?? []), { signature, memo: memo === null ? null : `[${memo.length}] ${memo}` }]);
  }

  /** Index a signature under an address that is not the fee payer (a reference key). */
  mention(address: string, signature: string, memo: string | null): void {
    this.mentioned.set(address, [...(this.mentioned.get(address) ?? []), { signature, memo: memo === null ? null : `[${memo.length}] ${memo}` }]);
  }
}
