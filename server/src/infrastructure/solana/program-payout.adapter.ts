import { Injectable, Logger } from '@nestjs/common';
import { Connection, Keypair, SYSVAR_CLOCK_PUBKEY, type Commitment } from '@solana/web3.js';
import { NotFoundError, ServiceUnavailableError } from '../../domain/shared/errors.js';
import { PoolChainPort } from '../../application/ports/economy/pool-chain.port.js';
import { PoolPayoutChainPort, type SignedPayout } from '../../application/ports/economy/pool-payout-chain.port.js';
import { EnvService } from '../config/env.service.js';
import { PoolProgramCodec } from './pool-program.codec.js';
import { CU_LIMITS, parseKeypair } from './program-chain.adapter.js';
import { broadcastUntilConfirmed, signWith, simulateSigned } from './signed-sender.js';
import { SolanaRpc, sleep } from './solana-rpc.js';

/**
 * The payout key on chain (PoolPayoutChainPort): signs AND pays `pay_prize` / `close_pool` with PAYOUT_SECRET – the program accepts it only as
 * Config.payout_authority and only after a pool's payout_at. Same RPC, commitment and send loop as the crank (signed-sender.ts).
 */
@Injectable()
export class ProgramPayoutAdapter extends PoolPayoutChainPort {
  private readonly logger = new Logger(ProgramPayoutAdapter.name);
  private readonly rpc: SolanaRpc;
  private readonly commitment: Commitment;
  private readonly key: Keypair | null;
  private codecCache: PoolProgramCodec | null = null;
  /** overridable in specs */
  protected wait: (ms: number) => Promise<void> = sleep;

  constructor(private readonly env: EnvService, private readonly chain: PoolChainPort) {
    super();
    this.commitment = env.solanaCommitment;
    this.rpc = new SolanaRpc(new Connection(env.solanaRpc, { commitment: this.commitment }), env.solanaRpcFallbacks.map((u) => new Connection(u, { commitment: this.commitment })), (ms) => this.wait(ms));
    this.key = env.payoutSecret && env.ticketProgramId ? parseKeypair(env.payoutSecret) : null; // a malformed key stops the boot, like any invalid env
  }

  get address(): string | null { return this.key?.publicKey.toBase58() ?? null; }

  private get codec(): PoolProgramCodec {
    if (!this.env.ticketProgramId) throw new ServiceUnavailableError('the pool program is not configured (TICKET_PROGRAM_ID)');
    return (this.codecCache ??= new PoolProgramCodec(this.env.ticketProgramId));
  }

  private get signer(): Keypair {
    if (!this.key) throw new ServiceUnavailableError('no payout key is configured (PAYOUT_SECRET)');
    return this.key;
  }

  async chainNow(): Promise<Date> {
    const info = await this.rpc.read((x) => x.getAccountInfo(SYSVAR_CLOCK_PUBKEY, this.commitment));
    if (!info) throw new ServiceUnavailableError('the RPC returned no Clock sysvar');
    return new Date(Number(info.data.readBigInt64LE(32)) * 1000);
  }

  async configuredPayoutAuthority(): Promise<string | null> {
    const c = this.codec;
    const info = await this.rpc.read((x) => x.getAccountInfo(c.configPda(), this.commitment));
    const cfg = info?.owner.equals(c.programId) ? c.decodeAccount('Config', info.data) : null;
    return cfg ? ((cfg['payoutAuthority'] as string | null) ?? null) : null;
  }

  async payPrize(i: { poolId: number; to: string; lamports: number; rank: number }, onSigned: (tx: SignedPayout) => Promise<void>): Promise<{ signature: string }> {
    const c = this.codec, key = this.signer;
    const ix = c.instruction('pay_prize', {
      authority: key.publicKey, config: c.configPda(), pool: c.poolPda(i.poolId), vault: c.vaultPda(i.poolId), to: i.to,
      attestation: c.attestationPda(i.poolId, i.to),
    }, { pool_id: i.poolId, lamports: i.lamports, rank: i.rank });
    const quote = await this.chain.feeQuote({ poolId: i.poolId, kind: 'pay_prize' });
    const tx = await signWith(this.rpc, this.commitment, key, [ix], CU_LIMITS.pay_prize, quote.priorityMicrolamports);
    const label = `pay_prize #${i.rank} of pool ${i.poolId}`;
    await simulateSigned(this.rpc, this.commitment, tx, label);
    await onSigned({ signature: tx.signature, lastValidBlockHeight: tx.lastValidBlockHeight });
    await broadcastUntilConfirmed(this.rpc, this.commitment, tx, label, (ms) => this.wait(ms), (m) => this.logger.debug(m));
    return { signature: tx.signature };
  }

  async closePool(poolId: number): Promise<{ signature: string }> {
    const c = this.codec, key = this.signer, pool = c.poolPda(poolId);
    const [poolInfo, configInfo] = await this.rpc.read((x) => x.getMultipleAccountsInfo([pool, c.configPda()], this.commitment));
    const p = poolInfo?.owner.equals(c.programId) ? c.decodeAccount('Pool', poolInfo.data) : null;
    const config = configInfo?.owner.equals(c.programId) ? c.decodeAccount('Config', configInfo.data) : null;
    if (!p || !config) throw new NotFoundError(`pool ${poolId} is not on chain`);
    const ix = c.instruction('close_pool', {
      caller: key.publicKey, pool_authority: String(p['authority']), config: c.configPda(), pool, vault: c.vaultPda(poolId),
      seed_treasury: String(p['seedTreasury']), fee_treasury: String(p['feeTreasury']), platform_treasury: String(config['platformTreasury']),
    }, { pool_id: poolId });
    const quote = await this.chain.feeQuote({ poolId, kind: 'close_pool' });
    const tx = await signWith(this.rpc, this.commitment, key, [ix], CU_LIMITS.close_pool, quote.priorityMicrolamports);
    const label = `close_pool ${poolId}`;
    await simulateSigned(this.rpc, this.commitment, tx, label);
    await broadcastUntilConfirmed(this.rpc, this.commitment, tx, label, (ms) => this.wait(ms), (m) => this.logger.debug(m));
    return { signature: tx.signature };
  }

  async isAttested(poolId: number, driver: string): Promise<boolean> {
    const c = this.codec;
    const pda = c.attestationPda(poolId, driver);
    const info = await this.rpc.read((x) => x.getAccountInfo(pda, this.commitment));
    if (!info || !info.owner.equals(c.programId)) return false;
    const acc = c.decodeAccount('Attestation', info.data);
    return acc !== null && acc['status'] === 1 && (acc['verifiedKm'] as number) > 0;
  }

  async recordAttestation(i: {
    poolId: number;
    driver: string;
    telemetryRoot: Uint8Array | Buffer;
    verifiedKm: number;
    status: number;
  }): Promise<{ signature: string }> {
    const c = this.codec, key = this.signer;
    const ix = c.instruction('record_attestation', {
      authority: key.publicKey,
      config: c.configPda(),
      pool: c.poolPda(i.poolId),
      driver_account: i.driver,
      attestation: c.attestationPda(i.poolId, i.driver),
    }, {
      pool_id: i.poolId,
      driver: i.driver,
      telemetry_root: i.telemetryRoot,
      verified_km: i.verifiedKm,
      status: i.status,
    });
    const quote = await this.chain.feeQuote({ poolId: i.poolId, kind: 'pay_prize' });
    const tx = await signWith(this.rpc, this.commitment, key, [ix], CU_LIMITS.record_attestation, quote.priorityMicrolamports);
    const label = `record_attestation pool ${i.poolId} driver ${i.driver}`;
    await simulateSigned(this.rpc, this.commitment, tx, label);
    await broadcastUntilConfirmed(this.rpc, this.commitment, tx, label, (ms) => this.wait(ms), (m) => this.logger.debug(m));
    return { signature: tx.signature };
  }
}
