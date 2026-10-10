import { Keypair, PublicKey, Transaction, TransactionInstruction } from '@solana/web3.js';
import bs58 from 'bs58';
import { randomBytes } from 'node:crypto';
import type { UnsignedPaymentTx } from '../../src/domain/economy/chain-transaction.js';
import type { ChainEventKind, ChainEventRecord, PoolChainState } from '../../src/domain/economy/chain-events.js';
import { ServiceUnavailableError } from '../../src/domain/shared/errors.js';
import { PoolChainPort, type BuiltTransaction, type ChainTxKind, type FeeQuote, type ProgramSignature, type SignatureStatus } from '../../src/application/ports/economy/pool-chain.port.js';
import { addFeePayerSignature, checkUserSignedTransaction } from '../../src/infrastructure/solana/transaction-cosigner.js';

export const newPoolSignature = (): string => bs58.encode(randomBytes(64));
/** stands in for the pool program in built transactions (the fake never runs anything) */
export const FAKE_PROGRAM_ID = new PublicKey(new Uint8Array(32).fill(9)).toBase58();

type EventFields<K extends ChainEventKind> = Omit<Extract<ChainEventRecord, { kind: K }>, 'kind' | 'signature' | 'index' | 'slot'>;
export interface BuiltRecord { kind: ChainTxKind; input: Record<string, unknown>; tx: BuiltTransaction }
export type ReadEventsAnswer = ChainEventRecord[] | 'pending' | { invalid: string };

/**
 * The pool program as a test double (docs/paid-tickets-plan.md §2.5): scripted events per signature, pool accounts, the program's signature history, statuses,
 * and a REAL gas-sponsor check – `cosignAndSend` runs the production message-equality / signature checks against the sponsor key, so a handler spec that forges a
 * message gets the same 400 as production. Built transactions are real (unsigned) Solana transactions, recorded in `built`.
 */
export class FakePoolChain extends PoolChainPort {
  readonly built: BuiltRecord[] = [];
  readonly events = new Map<string, ReadEventsAnswer>();
  readonly pools = new Map<number, PoolChainState>();
  /** the program's history, OLDEST first */
  signatures: ProgramSignature[] = [];
  readonly statuses = new Map<string, SignatureStatus>();
  readonly cosigned: { signedTransaction: string; expectedMessage: string; signature: string }[] = [];
  readonly listeners = new Set<(signature: string) => void>();
  quote: FeeQuote = { priorityMicrolamports: 1_000, computeUnits: 30_000, estimatedFeeLamports: 5_030 };
  simulation: { ok: true; unitsConsumed: number } | { ok: false; reason: string } = { ok: true, unitsConsumed: 20_000 };
  /** null = no gas sponsor configured (cosignAndSend → 503); set it to test the gasless path */
  sponsor: Keypair | null = null;
  /** replaces the default co-sign outcome (an Error is thrown; `confirmed: false` = sent but the outcome could not be told) */
  cosignResult: { signature: string; confirmed?: boolean } | Error | null = null;
  blockHeight = 100;
  lastValidBlockHeight = 250;
  readCount = 0;
  /** every feeQuote input, in order */
  readonly feeQuotes: { poolId: number | null; kind: ChainTxKind }[] = [];
  /** true = the RPC is down: every network call is a 503 */
  rpcDown = false;
  private slot = 0;

  reset(): void {
    this.built.length = 0; this.events.clear(); this.pools.clear(); this.signatures = []; this.statuses.clear(); this.cosigned.length = 0; this.listeners.clear();
    this.quote = { priorityMicrolamports: 1_000, computeUnits: 30_000, estimatedFeeLamports: 5_030 };
    this.simulation = { ok: true, unitsConsumed: 20_000 };
    this.sponsor = null; this.cosignResult = null; this.blockHeight = 100; this.lastValidBlockHeight = 250; this.readCount = 0; this.slot = 0;
    this.feeQuotes.length = 0; this.rpcDown = false;
  }

  // ---- scripting

  /** Puts a transaction with these pool events on the chain (readEvents answers them, the program history lists it). Returns its signature. */
  addTransaction(events: ({ kind: ChainEventKind } & Record<string, unknown>)[], signature = newPoolSignature()): string {
    const slot = ++this.slot;
    this.events.set(signature, events.map((e, index) => ({ ...e, signature, index, slot }) as ChainEventRecord));
    this.signatures.push({ signature, slot, failed: false });
    return signature;
  }
  /** one event – typed by kind */
  addEvent<K extends ChainEventKind>(kind: K, fields: EventFields<K>, signature?: string): string {
    return this.addTransaction([{ kind, ...fields }], signature);
  }
  /** the websocket saw `signature` */
  emitLogs(signature: string): void { for (const l of this.listeners) l(signature); }

  // ---- the port

  async buildBuyTransaction(input: { payer: string; poolId: number; qty: number; orderId: string; selfPaid?: boolean }): Promise<BuiltTransaction> {
    return this.build('buy', input, this.payerFor(input.payer, input.selfPaid), [input.payer]);
  }
  async buildRefundTransaction(input: { caller: string; poolId: number; buyer: string; needsFail: boolean; selfPaid?: boolean }): Promise<BuiltTransaction> {
    return this.build('refund', input, this.payerFor(input.caller, input.selfPaid), [input.caller]);
  }
  async buildPayPrizeTransaction(input: { authority: string; poolId: number; to: string; lamports: number; rank: number }): Promise<BuiltTransaction> {
    return this.build('pay_prize', input, input.authority, [input.authority]);
  }
  async buildClosePoolTransaction(input: { authority: string; poolId: number }): Promise<BuiltTransaction> {
    return this.build('close_pool', input, input.authority, [input.authority]);
  }

  async readEvents(signature: string): Promise<ReadEventsAnswer> {
    this.up();
    this.readCount++;
    return this.events.get(signature) ?? 'pending';
  }
  async readPool(poolId: number): Promise<PoolChainState | null> { this.up(); return this.pools.get(poolId) ?? null; }

  async recentProgramSignatures(after: string | null, limit: number): Promise<ProgramSignature[]> {
    this.up();
    if (after === null) return this.signatures.slice(-limit);
    const at = this.signatures.findIndex((s) => s.signature === after);
    return this.signatures.slice(at + 1, at + 1 + limit);
  }

  subscribeLogs(onSignature: (signature: string) => void): () => void {
    this.listeners.add(onSignature);
    return () => { this.listeners.delete(onSignature); };
  }

  async feeQuote(input: { poolId: number | null; kind: ChainTxKind }): Promise<FeeQuote> { this.up(); this.feeQuotes.push(input); return { ...this.quote }; }
  async simulate(_tx: UnsignedPaymentTx): Promise<{ ok: true; unitsConsumed: number } | { ok: false; reason: string }> { this.up(); return this.simulation; }

  async cosignAndSend(input: { signedTransaction: string; expectedMessage: string; lastValidBlockHeight: number }): Promise<{ signature: string; lastValidBlockHeight: number; confirmed: boolean }> {
    this.up();
    if (this.cosignResult instanceof Error) throw this.cosignResult;
    if (!this.sponsor) throw new ServiceUnavailableError('no gas sponsor is configured – pay the network fee yourself');
    const wire = checkUserSignedTransaction(Buffer.from(input.signedTransaction, 'base64'), Buffer.from(input.expectedMessage, 'base64'), this.sponsor.publicKey);
    const signature = this.cosignResult?.signature ?? bs58.encode(addFeePayerSignature(wire, this.sponsor.secretKey).subarray(1, 65));
    this.cosigned.push({ ...input, signature });
    return { signature, lastValidBlockHeight: input.lastValidBlockHeight, confirmed: this.cosignResult?.confirmed ?? true };
  }

  async signatureStatus(signature: string, lastValidBlockHeight: number): Promise<SignatureStatus> {
    this.up();
    return this.statuses.get(signature) ?? (this.blockHeight > lastValidBlockHeight ? 'expired' : 'unknown');
  }

  /** a real unsigned transaction: one instruction to FAKE_PROGRAM_ID carrying the input as JSON, signed by `signers` (+ the fee payer) */
  private payerFor(signer: string, selfPaid = false): string {
    return !selfPaid && this.sponsor ? this.sponsor.publicKey.toBase58() : signer;
  }

  private up(): void {
    if (this.rpcDown) throw new ServiceUnavailableError('Solana RPC unavailable');
  }

  private build(kind: ChainTxKind, input: Record<string, unknown>, feePayer: string, signers: string[]): BuiltTransaction {
    this.up();
    const blockhash = Keypair.generate().publicKey.toBase58();
    const ix = new TransactionInstruction({
      programId: new PublicKey(FAKE_PROGRAM_ID), data: Buffer.from(JSON.stringify({ kind, ...input })),
      keys: signers.map((s) => ({ pubkey: new PublicKey(s), isSigner: true, isWritable: true })),
    });
    const tx = new Transaction({ feePayer: new PublicKey(feePayer), blockhash, lastValidBlockHeight: this.lastValidBlockHeight }).add(ix);
    const built: BuiltTransaction = {
      transaction: tx.serialize({ requireAllSignatures: false, verifySignatures: false }).toString('base64'), message: tx.serializeMessage().toString('base64'),
      blockhash, lastValidBlockHeight: this.lastValidBlockHeight, feePayer, computeUnits: this.quote.computeUnits, priorityMicrolamports: this.quote.priorityMicrolamports,
    };
    this.built.push({ kind, input, tx: built });
    return built;
  }
}
