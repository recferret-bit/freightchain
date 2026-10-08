import { Injectable, Logger } from '@nestjs/common';
import { ComputeBudgetProgram, Connection, Keypair, SYSVAR_CLOCK_PUBKEY, Transaction, VersionedTransaction, type Commitment, type TransactionInstruction } from '@solana/web3.js';
import bs58 from 'bs58';
import type { PoolChainState } from '../../domain/economy/chain-events.js';
import { REFUND_BATCH } from '../../domain/economy/pool-crank.js';
import { ConflictError, NotFoundError, ServiceUnavailableError } from '../../domain/shared/errors.js';
import { PoolChainPort } from '../../application/ports/economy/pool-chain.port.js';
import { PoolCrankChainPort, type ChainTicket, type CrankInstruction } from '../../application/ports/economy/pool-crank-chain.port.js';
import { EnvService } from '../config/env.service.js';
import { POOL_PROGRAM_IDL } from './pool-program.idl.js';
import { PoolProgramCodec } from './pool-program.codec.js';
import { CU_LIMITS, parseKeypair, poolStateOf } from './program-chain.adapter.js';
import { SolanaRpc, sleep } from './solana-rpc.js';

const RESEND_MS = 2_000;
const MAX_RESENDS = 60;
/** getMultipleAccountsInfo takes at most 100 keys: 50 pools + their vaults per call */
const POOLS_PER_READ = 50;
/** Ticket: discriminator 8 | buyer 32 | rent_payer 32 | pool_id u32 (offset 72) | qty u16 | lamports u64 | bump u8 */
const TICKET_SIZE = 87;
const TICKET_POOL_ID_OFFSET = 72;

/**
 * The pool crank on chain (PoolCrankChainPort): reads every pool from Config.pool_count, the tickets still open with getProgramAccounts, the chain clock,
 * and sends the permissionless instructions signed AND paid by CRANK_SECRET. Same RPC and commitment as ProgramChainAdapter; the priority fee comes from
 * its estimator (feeQuote). Sends go to the primary RPC, re-sent every 2 s until confirmed or the blockhash is gone – the same pattern as the gas sponsor.
 */
@Injectable()
export class ProgramCrankAdapter extends PoolCrankChainPort {
  private readonly logger = new Logger(ProgramCrankAdapter.name);
  private readonly rpc: SolanaRpc;
  private readonly commitment: Commitment;
  private readonly crank: Keypair | null;
  private codecCache: PoolProgramCodec | null = null;
  /** overridable in specs */
  protected wait: (ms: number) => Promise<void> = sleep;

  constructor(private readonly env: EnvService, private readonly chain: PoolChainPort) {
    super();
    this.commitment = env.solanaCommitment;
    this.rpc = new SolanaRpc(new Connection(env.solanaRpc, { commitment: this.commitment }), env.solanaRpcFallbacks.map((u) => new Connection(u, { commitment: this.commitment })), (ms) => this.wait(ms));
    this.crank = env.crankSecret && env.ticketProgramId ? parseKeypair(env.crankSecret) : null; // a malformed key stops the boot, like any invalid env
  }

  get address(): string | null { return this.crank?.publicKey.toBase58() ?? null; }

  private get codec(): PoolProgramCodec {
    if (!this.env.ticketProgramId) throw new ServiceUnavailableError('the pool program is not configured (TICKET_PROGRAM_ID)');
    return (this.codecCache ??= new PoolProgramCodec(this.env.ticketProgramId));
  }

  async chainNow(): Promise<Date> {
    const info = await this.rpc.read((x) => x.getAccountInfo(SYSVAR_CLOCK_PUBKEY, this.commitment));
    if (!info) throw new ServiceUnavailableError('the RPC returned no Clock sysvar');
    return new Date(Number(info.data.readBigInt64LE(32)) * 1000); // Clock: slot u64 | epoch_start_timestamp i64 | epoch u64 | leader_schedule_epoch u64 | unix_timestamp i64
  }

  async listPools(): Promise<PoolChainState[]> {
    const c = this.codec;
    const config = await this.rpc.read((x) => x.getAccountInfo(c.configPda(), this.commitment));
    const cfg = config?.owner.equals(c.programId) ? c.decodeAccount('Config', config.data) : null;
    if (!cfg) return []; // not initialized yet
    const count = cfg['poolCount'] as number, out: PoolChainState[] = [];
    for (let from = 0; from < count; from += POOLS_PER_READ) {
      const ids = Array.from({ length: Math.min(POOLS_PER_READ, count - from) }, (_, i) => from + i);
      const infos = await this.rpc.read((x) => x.getMultipleAccountsInfo(ids.flatMap((id) => [c.poolPda(id), c.vaultPda(id)]), this.commitment));
      ids.forEach((id, i) => { const s = poolStateOf(c, id, infos[2 * i] ?? null, infos[2 * i + 1] ?? null); if (s) out.push(s); });
    }
    return out;
  }

  async listTickets(poolId: number): Promise<ChainTicket[]> {
    const c = this.codec;
    const disc = POOL_PROGRAM_IDL.accounts.find((a) => a.name === 'Ticket')!.discriminator;
    const id = Buffer.alloc(4); id.writeUInt32LE(poolId);
    const accounts = await this.rpc.read((x) => x.getProgramAccounts(c.programId, {
      commitment: this.commitment,
      filters: [{ dataSize: TICKET_SIZE }, { memcmp: { offset: 0, bytes: bs58.encode(Uint8Array.from(disc)) } }, { memcmp: { offset: TICKET_POOL_ID_OFFSET, bytes: bs58.encode(id) } }],
    }));
    return accounts.flatMap(({ account }) => {
      const t = c.decodeAccount('Ticket', account.data);
      return t && t['poolId'] === poolId ? [{ buyer: String(t['buyer']), rentPayer: String(t['rentPayer']), lamports: t['lamports'] as number }] : [];
    });
  }

  async send(i: CrankInstruction): Promise<{ signature: string }> {
    const crank = this.crank;
    if (!crank) throw new ServiceUnavailableError('no crank key is configured (CRANK_SECRET)');
    const [ixs, units] = await this.instructions(i, crank.publicKey.toBase58());
    const [{ blockhash, lastValidBlockHeight }, quote] = await Promise.all([
      this.rpc.read((x) => x.getLatestBlockhash(this.commitment)),
      this.chain.feeQuote({ poolId: i.poolId, kind: i.step === 'close_pool' ? 'close_pool' : 'refund' }),
    ]);
    const tx = new Transaction({ feePayer: crank.publicKey, blockhash, lastValidBlockHeight })
      .add(ComputeBudgetProgram.setComputeUnitLimit({ units }), ComputeBudgetProgram.setComputeUnitPrice({ microLamports: quote.priorityMicrolamports }), ...ixs);
    tx.sign(crank);
    const raw = tx.serialize(), signature = bs58.encode(tx.signature!);
    const sim = await this.rpc.read((x) => x.simulateTransaction(VersionedTransaction.deserialize(raw), { sigVerify: true, commitment: this.commitment }));
    if (sim.value.err) throw new ConflictError(`${i.step} on pool ${i.poolId} would fail: ${JSON.stringify(sim.value.err)} – ${sim.value.logs?.at(-1) ?? ''}`, 'transaction_would_fail');
    for (let n = 0; n < MAX_RESENDS; n++) {
      await this.rpc.primaryOnly((x) => x.sendRawTransaction(raw, { skipPreflight: true, maxRetries: 0 })).catch((e: unknown) => this.logger.debug(`re-send: ${(e as Error).message}`));
      await this.wait(RESEND_MS);
      const s = await this.rpc.primaryOnly(async (x) => (await x.getSignatureStatuses([signature], { searchTransactionHistory: true })).value[0]);
      if (s?.err) throw new ConflictError(`${i.step} on pool ${i.poolId} failed on chain: ${JSON.stringify(s.err)}`, 'transaction_failed');
      if (s?.confirmationStatus === 'finalized' || (s?.confirmationStatus === 'confirmed' && this.commitment === 'confirmed')) return { signature };
      if (!s && (await this.rpc.primaryOnly((x) => x.getBlockHeight(this.commitment))) > lastValidBlockHeight) {
        throw new ConflictError(`${i.step} on pool ${i.poolId} was dropped – the next crank pass sends it again`, 'transaction_dropped');
      }
    }
    throw new ConflictError(`${i.step} on pool ${i.poolId} (${signature}) is not confirmed yet – the watcher settles it when it lands`, 'transaction_unconfirmed');
  }

  /** the program instructions + their compute-unit limit; the crank is the `caller` of every one */
  private async instructions(i: CrankInstruction, caller: string): Promise<[TransactionInstruction[], number]> {
    const c = this.codec, pool = c.poolPda(i.poolId), vault = c.vaultPda(i.poolId);
    switch (i.step) {
      case 'fail_pool':
      case 'expire_pool':
        return [[c.instruction(i.step, { caller, pool }, { pool_id: i.poolId })], CU_LIMITS[i.step]];
      case 'refund': {
        const tickets = (i.tickets ?? []).slice(0, REFUND_BATCH);
        if (!tickets.length) throw new ConflictError(`no tickets to refund in pool ${i.poolId}`, 'nothing_to_refund');
        return [tickets.map((t) => c.instruction('refund', { caller, pool, vault, ticket: c.ticketPda(i.poolId, t.buyer), buyer: t.buyer, rent_payer: t.rentPayer }, { pool_id: i.poolId })),
          CU_LIMITS.refund * tickets.length];
      }
      case 'close_pool': {
        const [poolInfo, configInfo] = await this.rpc.read((x) => x.getMultipleAccountsInfo([pool, c.configPda()], this.commitment));
        const p = poolInfo?.owner.equals(c.programId) ? c.decodeAccount('Pool', poolInfo.data) : null;
        const config = configInfo?.owner.equals(c.programId) ? c.decodeAccount('Config', configInfo.data) : null;
        if (!p || !config) throw new NotFoundError(`pool ${i.poolId} is not on chain`);
        return [[c.instruction('close_pool', {
          caller, pool_authority: String(p['authority']), config: c.configPda(), pool, vault,
          seed_treasury: String(p['seedTreasury']), fee_treasury: String(p['feeTreasury']), platform_treasury: String(config['platformTreasury']),
        }, { pool_id: i.poolId })], CU_LIMITS.close_pool];
      }
    }
  }
}
