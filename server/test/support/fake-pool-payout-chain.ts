import { ConflictError, ServiceUnavailableError } from '../../src/domain/shared/errors.js';
import { ATTESTATION_FLAGGED, ATTESTATION_VERIFIED, PoolPayoutChainPort, type PledgeKeys, type SignedPayout } from '../../src/application/ports/economy/pool-payout-chain.port.js';
import { rideIdToBytes } from '../../src/domain/economy/pledge.types.js';
import { newPoolSignature, type FakePoolChain } from './fake-pool-chain.js';

/**
 * The payout key as a test double on top of a FakePoolChain: `payPrize` checks what the program would (active, payout_at reached by `now`, the prize cap), calls
 * `onSigned` BEFORE "broadcasting", then moves the lamports on the fake account and puts a PrizePaid transaction on its history; `closePool` settles the pool.
 * `address` null = no PAYOUT_SECRET (the default). `named` = what the program's Config says (defaults to the key itself). settle / refund_pledge do what
 * pledge.rs does to the FakePoolChain's Pledge accounts and put the PledgeSettled / PledgeRefunded on its history; `calls` lists every write in order.
 */
export class FakePoolPayoutChain extends PoolPayoutChainPort {
  payoutAddress: string | null = null;
  named: string | null | undefined = undefined;
  now = new Date(0);
  /** prize ranks / 'close' that fail on "chain" before anything is signed (a refused simulation) */
  readonly failing = new Set<string>();
  /** ranks whose broadcast is "dropped" after signing (the blockhash expires: transaction_dropped) */
  readonly dropping = new Set<number>();
  readonly prizes: { poolId: number; to: string; lamports: number; rank: number; signature: string }[] = [];
  readonly closed: number[] = [];
  readonly attestations = new Map<string, { telemetryRoot: Uint8Array | Buffer; verifiedKm: number; status: number }>();
  /** every chain write, in order: 'attest <pool> <driver> <status>', 'prize <pool> <rank>', 'close <pool>', 'settle <rideId> <sponsor>', 'refund <rideId> <sponsor>' */
  readonly calls: string[] = [];
  /** drivers whose record_attestation fails (an RPC error) */
  readonly failingAttestations = new Set<string>();
  /** reads of attestationOf */
  attestationReads = 0;

  constructor(private readonly chain: FakePoolChain) { super(); }

  /** back to no key and an empty chain record (the harness's reset) */
  reset(): void {
    this.payoutAddress = null; this.named = undefined; this.now = new Date(0);
    this.failing.clear(); this.dropping.clear(); this.prizes.length = 0; this.closed.length = 0; this.attestations.clear(); this.calls.length = 0;
    this.failingAttestations.clear(); this.attestationReads = 0;
  }

  get address(): string | null { return this.payoutAddress; }
  async chainNow(): Promise<Date> { return this.now; }
  async configuredPayoutAuthority(): Promise<string | null> { return this.named === undefined ? this.payoutAddress : this.named; }

  async attestationOf(poolId: number, driver: string): Promise<{ status: number; verifiedKm: number } | null> {
    this.attestationReads++;
    const a = this.attestations.get(`${poolId}:${driver}`);
    return a ? { status: a.status, verifiedKm: a.verifiedKm } : null;
  }

  async recordAttestation(i: { poolId: number; driver: string; telemetryRoot: Uint8Array | Buffer; verifiedKm: number; status: number }): Promise<{ signature: string }> {
    if (this.failingAttestations.has(i.driver)) throw new ServiceUnavailableError(`record_attestation for ${i.driver}: RPC unavailable`);
    const pool = this.chain.pools.get(i.poolId);
    if (pool && pool.status !== 'active') throw new ConflictError(`record_attestation pool ${i.poolId} would fail: PoolNotActive`, 'transaction_would_fail');
    this.attestations.set(`${i.poolId}:${i.driver}`, { telemetryRoot: i.telemetryRoot, verifiedKm: i.verifiedKm, status: i.status });
    this.calls.push(`attest ${i.poolId} ${i.driver} ${i.status}`);
    return { signature: newPoolSignature() };
  }

  async settlePledge(k: PledgeKeys): Promise<{ signature: string }> {
    if (!this.payoutAddress) throw new ServiceUnavailableError('no payout key');
    const acc = this.chain.pledgeAccounts.get(this.chain.pledgePda(rideIdToBytes(k.rideId), k.sponsor));
    if (!acc) throw new ConflictError(`settle_pledge ride ${k.rideId} would fail: AccountNotInitialized`, 'transaction_would_fail');
    const att = this.attestations.get(`${k.poolId}:${k.driver}`);
    if (!att || (att.status !== ATTESTATION_VERIFIED && att.status !== ATTESTATION_FLAGGED)) throw new ConflictError(`settle_pledge ride ${k.rideId} would fail: UnverifiedAttestation`, 'transaction_would_fail');
    const km = att.status === ATTESTATION_FLAGGED ? 0 : att.verifiedKm;
    const earned = (acc.maxLamports * BigInt(Math.min(km, acc.targetKm))) / BigInt(acc.targetKm);
    this.calls.push(`settle ${k.rideId} ${k.sponsor}`);
    const signature = this.chain.addPledgeTransaction([{ kind: 'PledgeSettled', rideId: acc.rideId, sponsor: acc.sponsor, driver: acc.driver, pool: acc.pool, verifiedKm: km, earnedLamports: earned, refundedLamports: acc.maxLamports - earned }]);
    return { signature };
  }

  async refundPledge(k: PledgeKeys): Promise<{ signature: string }> {
    if (!this.payoutAddress) throw new ServiceUnavailableError('no payout key');
    const acc = this.chain.pledgeAccounts.get(this.chain.pledgePda(rideIdToBytes(k.rideId), k.sponsor));
    if (!acc) throw new ConflictError(`refund_pledge ride ${k.rideId} would fail: AccountNotInitialized`, 'transaction_would_fail');
    const att = this.attestations.get(`${k.poolId}:${k.driver}`);
    if (att && (att.status === ATTESTATION_VERIFIED || att.status === ATTESTATION_FLAGGED)) throw new ConflictError(`refund_pledge ride ${k.rideId} would fail: AttestationExists`, 'transaction_would_fail');
    this.calls.push(`refund ${k.rideId} ${k.sponsor}`);
    const signature = this.chain.addPledgeTransaction([{ kind: 'PledgeRefunded', rideId: acc.rideId, sponsor: acc.sponsor, driver: acc.driver, pool: acc.pool, refundedLamports: acc.maxLamports }]);
    return { signature };
  }

  async payPrize(i: { poolId: number; to: string; lamports: number; rank: number }, onSigned: (tx: SignedPayout) => Promise<void>): Promise<{ signature: string }> {
    if (!this.payoutAddress) throw new ServiceUnavailableError('no payout key');
    const pool = this.chain.pools.get(i.poolId);
    if (!pool || pool.status !== 'active') throw new ConflictError(`pay_prize #${i.rank} of pool ${i.poolId} would fail: PoolNotActive`, 'transaction_would_fail');
    if (this.now.getTime() < pool.payoutAt.getTime()) throw new ConflictError(`pay_prize #${i.rank} of pool ${i.poolId} would fail: TooEarly`, 'transaction_would_fail');
    if (this.failing.has(String(i.rank))) throw new ConflictError(`pay_prize #${i.rank} of pool ${i.poolId} would fail: scripted`, 'transaction_would_fail');
    const signature = newPoolSignature();
    await onSigned({ signature, lastValidBlockHeight: this.chain.lastValidBlockHeight });
    if (this.dropping.has(i.rank)) { this.dropping.delete(i.rank); this.chain.statuses.set(signature, 'expired'); throw new ConflictError(`pay_prize #${i.rank} was dropped`, 'transaction_dropped'); }
    const prizesPaid = pool.prizesPaid + i.lamports;
    this.chain.pools.set(i.poolId, { ...pool, prizesPaid, vaultLamports: pool.vaultLamports - i.lamports, escrowLamports: pool.escrowLamports - i.lamports });
    this.chain.addTransaction([{ kind: 'PrizePaid', poolId: i.poolId, to: i.to, lamports: i.lamports, rank: i.rank, prizesPaidTotal: prizesPaid }], signature);
    this.chain.statuses.set(signature, 'confirmed');
    this.prizes.push({ ...i, signature });
    this.calls.push(`prize ${i.poolId} ${i.rank}`);
    return { signature };
  }

  async closePool(poolId: number): Promise<{ signature: string }> {
    const pool = this.chain.pools.get(poolId);
    if (!pool || pool.status !== 'active' || this.failing.has('close')) throw new ConflictError(`close_pool ${poolId} would fail`, 'transaction_would_fail');
    this.chain.pools.set(poolId, { ...pool, status: 'settled', vaultLamports: 0, escrowLamports: 0 });
    this.closed.push(poolId);
    this.calls.push(`close ${poolId}`);
    return { signature: this.chain.addTransaction([{ kind: 'PoolClosed', poolId, prizePaid: pool.prizesPaid, seed: 0, fee: 0, platformFee: 0, unclaimed: 0, rentReturned: 890_880, cancelled: false }]) };
  }
}
