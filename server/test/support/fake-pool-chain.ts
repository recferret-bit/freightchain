import { Keypair, PublicKey, Transaction, TransactionInstruction } from '@solana/web3.js';
import bs58 from 'bs58';
import { randomBytes } from 'node:crypto';
import type { UnsignedPaymentTx } from '../../src/domain/economy/chain-transaction.js';
import type { ChainEventKind, ChainEventRecord, PoolChainState } from '../../src/domain/economy/chain-events.js';
import { ServiceUnavailableError } from '../../src/domain/shared/errors.js';
import { rideIdToBytes, type PledgeChainEvent } from '../../src/domain/economy/pledge.types.js';
import { PoolChainPort, type BuiltTransaction, type ChainTxKind, type FeeQuote, type ProgramSignature, type SignatureStatus } from '../../src/application/ports/economy/pool-chain.port.js';

export const newPoolSignature = (): string => bs58.encode(randomBytes(64));
/** stands in for the pool program in built transactions (the fake never runs anything) */
export const FAKE_PROGRAM_ID = new PublicKey(new Uint8Array(32).fill(9)).toBase58();

type EventFields<K extends ChainEventKind> = Omit<Extract<ChainEventRecord, { kind: K }>, 'kind' | 'signature' | 'index' | 'slot'>;
export type BuiltKind = ChainTxKind | 'create_pledge';
export interface BuiltRecord { kind: BuiltKind; input: Record<string, unknown>; tx: BuiltTransaction }
export type ReadPledgeEventsAnswer = PledgeChainEvent[] | 'pending' | { invalid: string };
/** a pledge event as a test scripts it: the fake adds the signature and the slot */
export type PledgeEventInput = PledgeChainEvent extends infer E ? E extends PledgeChainEvent ? Omit<E, 'signature' | 'slot'> : never : never;
/** a Pledge account the fake holds (create_pledge put it there; settle / refund close it) */
export interface FakePledgeAccount { rideId: string; sponsor: string; driver: string; pool: string; maxLamports: bigint; lamportsPerKm: bigint; targetKm: number }
export type ReadEventsAnswer = ChainEventRecord[] | 'pending' | { invalid: string };

/**
 * The pool program as a test double (docs/paid-tickets-plan.md §2.5): scripted events per signature, pool accounts, the program's signature history, statuses,
 * and the signature statuses. Built transactions are real (unsigned) Solana transactions, paid by the signer, recorded in `built`.
 */
export class FakePoolChain extends PoolChainPort {
  readonly built: BuiltRecord[] = [];
  readonly events = new Map<string, ReadEventsAnswer>();
  readonly pools = new Map<number, PoolChainState>();
  /** the program's history, OLDEST first */
  signatures: ProgramSignature[] = [];
  readonly statuses = new Map<string, SignatureStatus>();
  readonly listeners = new Set<(signature: string) => void>();
  quote: FeeQuote = { priorityMicrolamports: 1_000, computeUnits: 30_000, estimatedFeeLamports: 5_030 };
  simulation: { ok: true; unitsConsumed: number } | { ok: false; reason: string } = { ok: true, unitsConsumed: 20_000 };
  blockHeight = 100;
  lastValidBlockHeight = 250;
  readCount = 0;
  /** every feeQuote input, in order */
  readonly feeQuotes: { poolId: number | null; kind: ChainTxKind }[] = [];
  /** true = the RPC is down: every network call is a 503 */
  rpcDown = false;
  /** pledge events per signature (readPledgeEvents) */
  readonly pledgeEvents = new Map<string, ReadPledgeEventsAnswer>();
  /** each pledge PDA's transactions, OLDEST first (pledgeSignatures answers newest first) */
  readonly pledgeHistory = new Map<string, string[]>();
  /** the open Pledge accounts by PDA */
  readonly pledgeAccounts = new Map<string, FakePledgeAccount>();
  /** PDAs whose history read fails (an RPC error on one pledge) */
  readonly failingPledgePdas = new Set<string>();
  private slot = 0;

  reset(): void {
    this.built.length = 0; this.events.clear(); this.pools.clear(); this.signatures = []; this.statuses.clear(); this.listeners.clear();
    this.quote = { priorityMicrolamports: 1_000, computeUnits: 30_000, estimatedFeeLamports: 5_030 };
    this.simulation = { ok: true, unitsConsumed: 20_000 };
    this.blockHeight = 100; this.lastValidBlockHeight = 250; this.readCount = 0; this.slot = 0;
    this.feeQuotes.length = 0; this.rpcDown = false;
    this.pledgeEvents.clear(); this.pledgeHistory.clear(); this.pledgeAccounts.clear(); this.failingPledgePdas.clear();
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
  /** Puts a transaction with these pledge events on the chain: readPledgeEvents answers them, each event's pledge PDA lists the signature; a PledgeCreated
      opens the account, a PledgeSettled / PledgeRefunded closes it (as the program does). Returns its signature. */
  addPledgeTransaction(events: PledgeEventInput[], signature = newPoolSignature()): string {
    const slot = ++this.slot;
    this.pledgeEvents.set(signature, events.map((e) => ({ ...e, signature, slot }) as PledgeChainEvent));
    for (const e of events) {
      const pda = this.pledgePda(rideIdToBytes(e.rideId), e.sponsor);
      this.pledgeHistory.set(pda, [...(this.pledgeHistory.get(pda) ?? []), signature]);
      if (e.kind === 'PledgeCreated') this.pledgeAccounts.set(pda, { rideId: e.rideId, sponsor: e.sponsor, driver: e.driver, pool: e.pool, maxLamports: e.maxLamports, lamportsPerKm: e.lamportsPerKm, targetKm: e.targetKm });
      else this.pledgeAccounts.delete(pda);
    }
    this.statuses.set(signature, 'confirmed');
    return signature;
  }
  /** the websocket saw `signature` */
  emitLogs(signature: string): void { for (const l of this.listeners) l(signature); }

  // ---- the port

  async buildBuyTransaction(input: { payer: string; poolId: number; qty: number; orderId: string; reference?: string | null }): Promise<BuiltTransaction> {
    return this.build('buy', input, input.payer, [input.payer]);
  }
  async buildRefundTransaction(input: { caller: string; poolId: number; buyer: string; needsFail: boolean }): Promise<BuiltTransaction> {
    return this.build('refund', input, input.caller, [input.caller]);
  }
  async buildPayPrizeTransaction(input: { authority: string; poolId: number; to: string; lamports: number; rank: number }): Promise<BuiltTransaction> {
    return this.build('pay_prize', input, input.authority, [input.authority]);
  }
  async buildClosePoolTransaction(input: { authority: string; poolId: number }): Promise<BuiltTransaction> {
    return this.build('close_pool', input, input.authority, [input.authority]);
  }

  async buildCreatePledgeTransaction(input: { sponsor: string; poolId: number; rideId: string; driver: string; lamportsPerKm: bigint; targetKm: number }): Promise<BuiltTransaction> {
    return this.build('create_pledge', { ...input, lamportsPerKm: input.lamportsPerKm.toString() }, input.sponsor, [input.sponsor]);
  }
  async readPledgeEvents(signature: string): Promise<ReadPledgeEventsAnswer> {
    this.up();
    return this.pledgeEvents.get(signature) ?? 'pending';
  }
  async pledgeSignatures(pda: string): Promise<string[]> {
    this.up();
    if (this.failingPledgePdas.has(pda)) throw new ServiceUnavailableError(`Solana RPC unavailable (history of ${pda})`);
    return [...(this.pledgeHistory.get(pda) ?? [])].reverse();
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

  async signatureStatus(signature: string, lastValidBlockHeight: number): Promise<SignatureStatus> {
    this.up();
    return this.statuses.get(signature) ?? (this.blockHeight > lastValidBlockHeight ? 'expired' : 'unknown');
  }

  /** a real unsigned transaction: one instruction to FAKE_PROGRAM_ID carrying the input as JSON, signed by `signers` (+ the fee payer) */
  private up(): void {
    if (this.rpcDown) throw new ServiceUnavailableError('Solana RPC unavailable');
  }

  private build(kind: BuiltKind, input: Record<string, unknown>, feePayer: string, signers: string[]): BuiltTransaction {
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

  pledgePda(rideId: Uint8Array | Buffer | number[], sponsor: string): string {
    try {
      const rideIdBuf = Buffer.isBuffer(rideId) ? rideId : Buffer.from(rideId);
      return PublicKey.findProgramAddressSync([Buffer.from('pledge'), rideIdBuf, new PublicKey(sponsor).toBuffer()], new PublicKey(FAKE_PROGRAM_ID))[0].toBase58();
    } catch {
      return `PledgePDA_${sponsor}_${Buffer.from(rideId).slice(0, 4).toString('hex')}`;
    }
  }
}
