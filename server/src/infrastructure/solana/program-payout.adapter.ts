import { Injectable, Logger } from '@nestjs/common';
import { Connection, Keypair, SYSVAR_CLOCK_PUBKEY, type Commitment, type TransactionInstruction } from '@solana/web3.js';
import { rideIdToBytes } from '../../domain/economy/pledge.types.js';
import { NotFoundError, ServiceUnavailableError } from '../../domain/shared/errors.js';
import { PoolChainPort } from '../../application/ports/economy/pool-chain.port.js';
import { PoolPayoutChainPort, type PledgeKeys, type RideAttestationState, type SignedPayout } from '../../application/ports/economy/pool-payout-chain.port.js';
import { EnvService } from '../config/env.service.js';
import { PoolProgramCodec } from './pool-program.codec.js';
import { commitWinnersIx, CU_LIMITS, parseKeypair, payPrizeIx } from './program-chain.adapter.js';
import { broadcastUntilConfirmed, signWith, simulateSigned } from './signed-sender.js';
import { SolanaRpc, sleep } from './solana-rpc.js';

/**
 * The payout key on chain (PoolPayoutChainPort): signs AND pays `commit_winners` / `record_ride_attestation` / `close_pool` with PAYOUT_SECRET (the program accepts
 * them only from Config.payout_authority or the admin) and sends the permissionless `pay_prize` / `settle_pledge` / `refund_pledge`. Same RPC, commitment and send
 * loop as the crank (signed-sender.ts).
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

  async commitWinners(i: { poolId: number; root: Uint8Array; total: number; count: number }): Promise<{ signature: string }> {
    return this.send(i.poolId, commitWinnersIx(this.codec, this.signer.publicKey, i), CU_LIMITS.commit_winners, `commit_winners pool ${i.poolId} (${i.count} rank(s))`);
  }

  async payPrize(i: { poolId: number; rank: number; to: string; lamports: number; proof: Uint8Array[] }, onSigned: (tx: SignedPayout) => Promise<void>): Promise<{ signature: string }> {
    const c = this.codec, key = this.signer;
    const ix = payPrizeIx(c, key.publicKey, i);
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

  async rideAttestationOf(poolId: number, rideId: string): Promise<RideAttestationState | null> {
    const c = this.codec;
    const info = await this.rpc.read((x) => x.getAccountInfo(c.rideAttestationPda(poolId, rideIdToBytes(rideId)), this.commitment));
    const a = info?.owner.equals(c.programId) ? c.decodeAccount('RideAttestation', info.data) : null;
    return a ? { driver: String(a['driver']), status: a['status'] as number, verifiedKm: a['verifiedKm'] as number, settleFrom: a['settleFrom'] as Date, settledPledges: a['settledPledges'] as number } : null;
  }

  async recordRideAttestation(i: { poolId: number; rideId: string; driver: string; telemetryRoot: Uint8Array | Buffer; verifiedKm: number; status: number }): Promise<{ signature: string }> {
    const c = this.codec, key = this.signer, rideId = rideIdToBytes(i.rideId);
    const ix = c.instruction('record_ride_attestation', {
      authority: key.publicKey, config: c.configPda(), pool: c.poolPda(i.poolId), ride_attestation: c.rideAttestationPda(i.poolId, rideId),
    }, { pool_id: i.poolId, ride_id: rideId, driver: i.driver, telemetry_root: Uint8Array.from(i.telemetryRoot), verified_km: i.verifiedKm, status: i.status });
    return this.send(i.poolId, ix, CU_LIMITS.record_ride_attestation, `record_ride_attestation pool ${i.poolId} ride ${i.rideId}`);
  }

  async settlePledge(k: PledgeKeys): Promise<{ signature: string }> {
    const c = this.codec, key = this.signer, rideId = rideIdToBytes(k.rideId);
    const ix = c.instruction('settle_pledge', {
      caller: key.publicKey, driver: k.driver, sponsor: k.sponsor, config: c.configPda(), pool: c.poolPda(k.poolId),
      ride_attestation: c.rideAttestationPda(k.poolId, rideId), pledge: c.pledgePda(rideId, k.sponsor),
    }, { ride_id: rideId });
    return this.send(k.poolId, ix, CU_LIMITS.settle_pledge, `settle_pledge ride ${k.rideId} sponsor ${k.sponsor}`);
  }

  async refundPledge(k: PledgeKeys): Promise<{ signature: string }> {
    const c = this.codec, key = this.signer, rideId = rideIdToBytes(k.rideId);
    const ix = c.instruction('refund_pledge', {
      caller: key.publicKey, sponsor: k.sponsor, pool: c.poolPda(k.poolId), ride_attestation: c.rideAttestationPda(k.poolId, rideId), pledge: c.pledgePda(rideId, k.sponsor),
    }, { ride_id: rideId });
    return this.send(k.poolId, ix, CU_LIMITS.refund_pledge, `refund_pledge ride ${k.rideId} sponsor ${k.sponsor}`);
  }

  /** sign with the payout key, simulate (a program error is a ConflictError naming it), send until confirmed */
  private async send(poolId: number, ix: TransactionInstruction, units: number, label: string): Promise<{ signature: string }> {
    const quote = await this.chain.feeQuote({ poolId, kind: 'pay_prize' });
    const tx = await signWith(this.rpc, this.commitment, this.signer, [ix], units, quote.priorityMicrolamports);
    await simulateSigned(this.rpc, this.commitment, tx, label);
    await broadcastUntilConfirmed(this.rpc, this.commitment, tx, label, (ms) => this.wait(ms), (m) => this.logger.debug(m));
    return { signature: tx.signature };
  }
}
