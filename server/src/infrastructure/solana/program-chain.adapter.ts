import { Injectable, Logger } from '@nestjs/common';
import { ComputeBudgetProgram, Connection, Keypair, PublicKey, Transaction, VersionedTransaction, type AccountInfo, type Commitment, type TransactionInstruction } from '@solana/web3.js';
import bs58 from 'bs58';
import type { UnsignedPaymentTx } from '../../domain/economy/chain-transaction.js';
import type { ChainEventRecord, PoolChainState, SeriesChainState } from '../../domain/economy/chain-events.js';
import { orderIdToBytes } from '../../domain/economy/ticket-purchase-verification.js';
import { escrowOf } from '../../domain/economy/vault-split.js';
import { ConflictError, NotFoundError, ServiceUnavailableError } from '../../domain/shared/errors.js';
import { ClockPort } from '../../application/ports/shared/clock.port.js';
import { PoolChainPort, type BuiltTransaction, type ChainTxKind, type FeeQuote, type ProgramSignature, type SignatureStatus } from '../../application/ports/economy/pool-chain.port.js';
import { EnvService } from '../config/env.service.js';
import { FeeEstimator, estimateFeeLamports, type QnPriorityFees } from './fee-estimator.js';
import { memoInstruction } from './chain-transaction.mapper.js';
import { PoolProgramCodec, UnrepresentableValueError } from './pool-program.codec.js';
import { SolanaRpc, sleep } from './solana-rpc.js';

/** Compute-unit limits: the LiteSVM measurements (README, server/test/fixtures/chain) + headroom for the Ticket PDA's bump SEARCH. `buy_ticket` (init_if_needed) and
    `refund` derive the Ticket address with find_program_address in the program: every bump tried costs 1 500 CU, and how many it takes is fixed per wallet and pool
    (a wallet needing k extra tries has probability 2^-k). With 30k / 18k an unlucky wallet (~1 in 128 for buys, ~1 in 8 for refunds) could NEVER buy / be refunded
    by a server-built transaction – found by the devnet rehearsal ("exceeded CUs meter"). 60k / 45k leave ≥ 20 extra tries (2^-20). The limit is a cap, not a charge
    (the fee is priority price × limit, ~0 on devnet). */
export const CU_LIMITS = { buy: 60_000, refund: 45_000, fail_pool: 6_000, expire_pool: 6_000, pay_prize: 17_000, close_pool: 30_000, open_next_pool: 40_000 } as const;
const MAX_SIGNATURE_PAGES = 10;
const STATUS = ['open', 'active', 'refunding', 'settled', 'cancelled'] as const;

/** A Pool account (+ its vault's balance, read in the same slot) as the domain's PoolChainState; null = not this program's pool. Shared with the crank adapter.
    `rentMin` = the cluster's rent-exempt minimum of a 0-byte account (the vault keeps it): 890 880 on mainnet / a local validator, 650 240 on devnet today. */
export function poolStateOf(c: PoolProgramCodec, poolId: number, info: AccountInfo<Buffer> | null, vaultInfo: AccountInfo<Buffer> | null, rentMin: number): PoolChainState | null {
  if (!info || !info.owner.equals(c.programId)) return null;
  const p = c.decodeAccount('Pool', info.data);
  if (!p) return null;
  const status = STATUS[p['status'] as number];
  if (!status) throw new Error(`pool ${poolId} has an unknown status ${String(p['status'])}`);
  const vaultLamports = vaultInfo?.lamports ?? 0;
  return {
    poolId: p['poolId'] as number, address: c.poolPda(poolId).toBase58(), status, ticketsSold: p['ticketsSold'] as number, buyers: p['buyers'] as number,
    sponsored: p['sponsored'] as number, prizesPaid: p['prizesPaid'] as number, refunded: p['refunded'] as number,
    vaultLamports, escrowLamports: escrowOf(vaultLamports, rentMin), vault: c.vaultPda(poolId).toBase58(), authority: p['authority'] as string, tier: p['tier'] as number,
    priceLamports: p['priceLamports'] as number, minTickets: p['minTickets'] as number, maxTickets: p['maxTickets'] as number, maxPerWallet: p['maxPerWallet'] as number,
    prepDeadline: p['prepDeadline'] as Date, playDeadline: p['playDeadline'] as Date, payoutAt: p['payoutAt'] as Date, prizeBps: p['prizeBps'] as number, seedBps: p['seedBps'] as number,
    feeBps: p['feeBps'] as number, feeTreasury: p['feeTreasury'] as string, seedTreasury: p['seedTreasury'] as string, createdAt: p['createdAt'] as Date,
  };
}

/** A Series account (one per tier, `set_series`) as the domain's SeriesChainState; null = not this program's series. */
export function seriesStateOf(c: PoolProgramCodec, info: AccountInfo<Buffer> | null, address: string): SeriesChainState | null {
  if (!info || !info.owner.equals(c.programId)) return null;
  const s = c.decodeAccount('Series', info.data);
  if (!s) return null;
  const secs = (k: string) => Math.round((s[k] as Date).getTime() / 1000); // i64 fields decode as Date; these are durations
  return {
    address, tier: s['tier'] as number, enabled: s['enabled'] as boolean, priceLamports: s['priceLamports'] as number, minTickets: s['minTickets'] as number,
    maxTickets: s['maxTickets'] as number, maxPerWallet: s['maxPerWallet'] as number, saleSecs: secs('saleSecs'), playSecs: secs('playSecs'), verifySecs: secs('verifySecs'),
    prizeBps: s['prizeBps'] as number, seedBps: s['seedBps'] as number, feeBps: s['feeBps'] as number, feeTreasury: s['feeTreasury'] as string,
    seedTreasury: s['seedTreasury'] as string, nextOpenAt: s['nextOpenAt'] as Date, poolsOpened: s['poolsOpened'] as number, lastPoolId: (s['lastPoolId'] as number | null) ?? null,
  };
}

/** `CRANK_SECRET`: base58 of the 64-byte secret key, or the JSON array `solana-keygen` writes. */
export function parseKeypair(secret: string): Keypair {
  const trimmed = secret.trim();
  const bytes = trimmed.startsWith('[') ? Uint8Array.from(JSON.parse(trimmed) as number[]) : bs58.decode(trimmed);
  return Keypair.fromSecretKey(bytes);
}

/**
 * PAYMENT_MODE=program: the Anchor pool program (programs/freightchain-pools). Builds unsigned transactions for wallets, reads and decodes what the program did,
 * (every wallet signs AND pays its own transaction – the server holds no fee-payer key). Never connects at construction (the app boots without a program configured); every call then says
 * "unavailable" instead. Reads fall back over SOLANA_RPC_FALLBACKS; sends go to SOLANA_RPC only.
 */
@Injectable()
export class ProgramChainAdapter extends PoolChainPort {
  private readonly logger = new Logger(ProgramChainAdapter.name);
  private readonly rpc: SolanaRpc;
  private readonly commitment: Commitment;
  private readonly fees: FeeEstimator;
  private codecCache: PoolProgramCodec | null = null;
  private rentMinCache: Promise<number> | null = null;
  /** overridable in specs */
  protected wait: (ms: number) => Promise<void> = sleep;

  constructor(private readonly env: EnvService, clock: ClockPort) {
    super();
    this.commitment = env.solanaCommitment;
    this.rpc = new SolanaRpc(new Connection(env.solanaRpc, { commitment: this.commitment }), env.solanaRpcFallbacks.map((u) => new Connection(u, { commitment: this.commitment })), (ms) => this.wait(ms));
    this.fees = new FeeEstimator({
      qnEstimate: (account) => this.rpc.read(async (c) => {
        const res = (await (c as unknown as { _rpcRequest(m: string, p: unknown): Promise<{ result?: QnPriorityFees; error?: { code: number; message: string } }> })
          ._rpcRequest('qn_estimatePriorityFees', { last_n_blocks: 100, account, api_version: 2 }));
        if (res.error) {
          if (res.error.code === -32601 || /not (found|supported)/i.test(res.error.message)) return 'unsupported' as const;
          throw new Error(res.error.message);
        }
        return res.result ?? 'unsupported';
      }),
      recentFees: (accounts) => this.rpc.read(async (c) => (await c.getRecentPrioritizationFees({ lockedWritableAccounts: accounts.map((a) => new PublicKey(a)) })).map((f) => f.prioritizationFee)),
    }, env.priorityFee, () => clock.now().getTime());
  }

  private get codec(): PoolProgramCodec {
    if (!this.env.ticketProgramId) throw new ServiceUnavailableError('the pool program is not configured (TICKET_PROGRAM_ID)');
    return (this.codecCache ??= new PoolProgramCodec(this.env.ticketProgramId));
  }

  // ---- builders

  async buildBuyTransaction(i: { payer: string; poolId: number; qty: number; orderId: string; reference?: string | null }): Promise<BuiltTransaction> {
    const c = this.codec;
    const ix = c.instruction('buy_ticket', {
      buyer: i.payer, fee_payer: i.payer, config: c.configPda(), pool: c.poolPda(i.poolId), vault: c.vaultPda(i.poolId), ticket: c.ticketPda(i.poolId, i.payer),
    }, { pool_id: i.poolId, qty: i.qty, order_id: orderIdToBytes(i.orderId) });
    // The reference sits on its own memo. buy_ticket's account list is fixed; Anchor rejects an extra account there.
    const ixs = i.reference ? [ix, memoInstruction(i.orderId, [], i.reference)] : [ix];
    return this.build(ixs, i.payer, i.poolId, CU_LIMITS.buy);
  }

  async buildRefundTransaction(i: { caller: string; poolId: number; buyer: string; needsFail: boolean }): Promise<BuiltTransaction> {
    const c = this.codec, ticket = c.ticketPda(i.poolId, i.buyer);
    const info = await this.rpc.read((x) => x.getAccountInfo(ticket, this.commitment));
    const t = info && info.owner.equals(c.programId) ? c.decodeAccount('Ticket', info.data) : null;
    if (!t) throw new ConflictError(`${i.buyer} holds no ticket in pool ${i.poolId} (never bought, or refunded already)`, 'no_ticket');
    const ixs: TransactionInstruction[] = [];
    if (i.needsFail) ixs.push(c.instruction('fail_pool', { caller: i.caller, pool: c.poolPda(i.poolId) }, { pool_id: i.poolId }));
    ixs.push(c.instruction('refund', {
      caller: i.caller, pool: c.poolPda(i.poolId), vault: c.vaultPda(i.poolId), ticket, buyer: i.buyer, rent_payer: String(t['rentPayer']),
    }, { pool_id: i.poolId }));
    return this.build(ixs, i.caller, i.poolId, CU_LIMITS.refund + (i.needsFail ? CU_LIMITS.fail_pool : 0));
  }

  async buildPayPrizeTransaction(i: { authority: string; poolId: number; to: string; lamports: number; rank: number }): Promise<BuiltTransaction> {
    const c = this.codec;
    const ix = c.instruction('pay_prize', { authority: i.authority, config: c.configPda(), pool: c.poolPda(i.poolId), vault: c.vaultPda(i.poolId), to: i.to },
      { pool_id: i.poolId, lamports: i.lamports, rank: i.rank });
    return this.build([ix], i.authority, i.poolId, CU_LIMITS.pay_prize);
  }

  async buildClosePoolTransaction(i: { authority: string; poolId: number }): Promise<BuiltTransaction> {
    const c = this.codec;
    const [poolInfo, configInfo] = await this.rpc.read((x) => x.getMultipleAccountsInfo([c.poolPda(i.poolId), c.configPda()], this.commitment));
    const pool = poolInfo?.owner.equals(c.programId) ? c.decodeAccount('Pool', poolInfo.data) : null;
    const config = configInfo?.owner.equals(c.programId) ? c.decodeAccount('Config', configInfo.data) : null;
    if (!pool || !config) throw new NotFoundError(`pool ${i.poolId} is not on chain`);
    const ix = c.instruction('close_pool', {
      caller: i.authority, pool_authority: String(pool['authority']), config: c.configPda(), pool: c.poolPda(i.poolId), vault: c.vaultPda(i.poolId),
      seed_treasury: String(pool['seedTreasury']), fee_treasury: String(pool['feeTreasury']), platform_treasury: String(config['platformTreasury']),
    }, { pool_id: i.poolId });
    return this.build([ix], i.authority, i.poolId, CU_LIMITS.close_pool);
  }

  /** compute budget first, then the program's instructions; a fresh blockhash per build (it lives ~60–90 s) */
  private async build(ixs: TransactionInstruction[], feePayer: string, poolId: number, computeUnits: number): Promise<BuiltTransaction> {
    const c = this.codec;
    const [{ blockhash, lastValidBlockHeight }, priorityMicrolamports] = await Promise.all([
      this.rpc.read((x) => x.getLatestBlockhash(this.commitment)),
      this.fees.priorityMicrolamports([c.poolPda(poolId).toBase58(), c.vaultPda(poolId).toBase58()]),
    ]);
    const tx = new Transaction({ feePayer: new PublicKey(feePayer), blockhash, lastValidBlockHeight })
      .add(ComputeBudgetProgram.setComputeUnitLimit({ units: computeUnits }), ComputeBudgetProgram.setComputeUnitPrice({ microLamports: priorityMicrolamports }), ...ixs);
    return {
      transaction: tx.serialize({ requireAllSignatures: false, verifySignatures: false }).toString('base64'),
      message: tx.serializeMessage().toString('base64'),
      blockhash, lastValidBlockHeight, feePayer, computeUnits, priorityMicrolamports,
    };
  }

  // ---- reading the chain

  async readEvents(signature: string): Promise<ChainEventRecord[] | 'pending' | { invalid: string }> {
    const c = this.codec;
    const tx = await this.rpc.read((x) => x.getTransaction(signature, { commitment: this.commitment === 'finalized' ? 'finalized' : 'confirmed', maxSupportedTransactionVersion: 0 }));
    if (!tx) return 'pending';
    if (!tx.meta) return { invalid: 'the transaction has no metadata' };
    if (tx.meta.err) return { invalid: `the transaction failed: ${JSON.stringify(tx.meta.err)}` };
    const logs = tx.meta.logMessages ?? [];
    if (!logs.some((l) => l.startsWith(`Program ${c.programId.toBase58()} invoke`))) return { invalid: 'not a pool program transaction' };
    try {
      const events = c.poolEvents(logs, signature, tx.slot);
      return events === 'truncated' ? { invalid: 'the transaction logs were truncated' } : events;
    } catch (e) {
      return { invalid: e instanceof UnrepresentableValueError ? e.message : `undecodable program data: ${(e as Error).message}` };
    }
  }

  async readPool(poolId: number): Promise<PoolChainState | null> {
    const c = this.codec;
    const [[info, vaultInfo], rentMin] = await Promise.all([
      this.rpc.read((x) => x.getMultipleAccountsInfo([c.poolPda(poolId), c.vaultPda(poolId)], this.commitment)), this.vaultRentMin(),
    ]);
    return poolStateOf(c, poolId, info, vaultInfo ?? null, rentMin);
  }

  /** The cluster's rent-exempt minimum of the 0-byte vault, read once (it differs between clusters: devnet's is lower than mainnet's). */
  async vaultRentMin(): Promise<number> {
    return (this.rentMinCache ??= this.rpc.read((x) => x.getMinimumBalanceForRentExemption(0, this.commitment)).catch((e: unknown) => { this.rentMinCache = null; throw e; }));
  }

  /** getSignaturesForAddress pages newest → oldest; walk back (`before`) until the cursor, so nothing between the cursor and the head is skipped. */
  async recentProgramSignatures(after: string | null, limit: number): Promise<ProgramSignature[]> {
    const program = this.codec.programId;
    const commitment = this.commitment === 'finalized' ? 'finalized' : 'confirmed';
    const seen: ProgramSignature[] = [];
    let before: string | undefined;
    for (let page = 0; page < MAX_SIGNATURE_PAGES; page++) {
      const batch = await this.rpc.read((x) => x.getSignaturesForAddress(program, { until: after ?? undefined, before, limit: 1000 }, commitment));
      seen.push(...batch.map((s) => ({ signature: s.signature, slot: s.slot, failed: s.err !== null })));
      if (batch.length < 1000 || after === null) break; // reached the cursor (or no cursor: the newest page is enough)
      before = batch.at(-1)!.signature;
    }
    const oldestFirst = seen.reverse();
    return after === null ? oldestFirst.slice(-limit) : oldestFirst.slice(0, limit);
  }

  subscribeLogs(onSignature: (signature: string) => void): () => void {
    if (!this.env.ticketProgramId || !this.env.solanaWs) return () => undefined;
    const ws = new Connection(this.env.solanaRpc, { commitment: this.commitment, wsEndpoint: this.env.solanaWs });
    const id = ws.onLogs(this.codec.programId, (l) => { if (!l.err) onSignature(l.signature); }, this.commitment);
    return () => { ws.removeOnLogsListener(id).catch(() => undefined); };
  }

  async feeQuote(i: { poolId: number | null; kind: ChainTxKind }): Promise<FeeQuote> {
    // no pool: the program's own recent fees – or, with no program configured (transfer mode), the network's
    const hot = i.poolId !== null ? [this.codec.poolPda(i.poolId).toBase58(), this.codec.vaultPda(i.poolId).toBase58()] : this.env.ticketProgramId ? [this.codec.programId.toBase58()] : [];
    const priorityMicrolamports = await this.fees.priorityMicrolamports(hot);
    const computeUnits = i.kind === 'refund' ? CU_LIMITS.refund + CU_LIMITS.fail_pool : CU_LIMITS[i.kind];
    return { priorityMicrolamports, computeUnits, estimatedFeeLamports: estimateFeeLamports(1, priorityMicrolamports, computeUnits) };
  }

  async simulate(tx: UnsignedPaymentTx): Promise<{ ok: true; unitsConsumed: number } | { ok: false; reason: string }> {
    const vtx = VersionedTransaction.deserialize(Buffer.from(tx.transaction, 'base64'));
    const { value } = await this.rpc.read((x) => x.simulateTransaction(vtx, { sigVerify: false, commitment: this.commitment }));
    if (!value.err) return { ok: true, unitsConsumed: value.unitsConsumed ?? 0 };
    return { ok: false, reason: this.reason(value.err, value.logs ?? []) };
  }

  /** a program error by its IDL name, else the runtime's own words */
  private reason(err: unknown, logs: readonly string[]): string {
    const custom = (err as { InstructionError?: [number, { Custom?: number } | string] }).InstructionError?.[1];
    const code = typeof custom === 'object' ? custom.Custom : undefined;
    const named = code === undefined || !this.env.ticketProgramId ? null : this.codec.errorName(code);
    return named ?? `${JSON.stringify(err)}${logs.length ? ` – ${logs.at(-1)}` : ''}`;
  }

  /** A landed transaction reports its commitment even when it failed (readEvents calls that one invalid). */
  async signatureStatus(signature: string, lastValidBlockHeight: number): Promise<SignatureStatus> {
    return (await this.status(signature, lastValidBlockHeight)).status;
  }

  /** Both answers from the PRIMARY: 'expired' voids credited tickets, so "unknown signature" must not come from a fallback with less history (503 = ask again later). */
  private async status(signature: string, lastValidBlockHeight: number): Promise<{ status: SignatureStatus; err: unknown }> {
    return this.rpc.primaryOnly(async (x) => {
      const s = (await x.getSignatureStatuses([signature], { searchTransactionHistory: true })).value[0];
      if (s?.confirmationStatus) return { status: s.confirmationStatus, err: s.err };
      const height = await x.getBlockHeight(this.commitment);
      return { status: height > lastValidBlockHeight ? 'expired' : 'unknown', err: null };
    });
  }
}
