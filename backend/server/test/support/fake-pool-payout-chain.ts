import { createHash } from 'node:crypto';
import { ConflictError, ServiceUnavailableError } from '../../src/domain/shared/errors.js';
import { ATTESTATION_FLAGGED, ATTESTATION_VERIFIED, PoolPayoutChainPort, type PledgeKeys, type RideAttestationState, type SignedPayout } from '../../src/application/ports/economy/pool-payout-chain.port.js';
import { rideIdToBytes } from '../../src/domain/economy/pledge.types.js';
import { rootFromProof, winnerLeaf } from '../../src/domain/economy/winners-merkle.js';
import { newPoolSignature, type FakePoolChain } from './fake-pool-chain.js';

const sha = (d: Uint8Array | Buffer) => createHash('sha256').update(d).digest();

/**
 * The payout key as a test double on top of a FakePoolChain, checking what program v4 would: `commitWinners` writes the root on the fake Pool account (active, past
 * the play deadline by `now`, none yet) with its `payFrom` (max(payout_at, now + max(review window, `minReviewMs`))); `payPrize` checks the lock, the rank bit and
 * the proof against that root, calls `onSigned` BEFORE "broadcasting", then moves the lamports, sets the bit and puts a PrizePaid on the fake history; `closePool`
 * needs every committed rank paid. Ride attestations live per (pool, ride); settle / refund_pledge do what pledge.rs does to the FakePoolChain's Pledge accounts.
 * `address` null = no PAYOUT_SECRET (the default). `named` = what the program's Config says (defaults to the key itself). `calls` lists every write in order.
 */
export class FakePoolPayoutChain extends PoolPayoutChainPort {
  payoutAddress: string | null = null;
  named: string | null | undefined = undefined;
  now = new Date(0);
  /** the program's Config.min_review_secs (ms) – the pool's own snapshot in the program; 0 in these specs unless set */
  minReviewMs = 0;
  /** prize ranks / 'close' / 'commit' that fail on "chain" before anything is signed (a refused simulation) */
  readonly failing = new Set<string>();
  /** ranks whose broadcast is "dropped" after signing (the blockhash expires: transaction_dropped) */
  readonly dropping = new Set<number>();
  readonly prizes: { poolId: number; to: string; lamports: number; rank: number; signature: string }[] = [];
  readonly closed: number[] = [];
  readonly attestations = new Map<string, RideAttestationState & { telemetryRoot: Uint8Array | Buffer }>();
  /** every chain write, in order: 'commit <pool> <count>', 'attest <pool> <rideId> <status>', 'prize <pool> <rank>', 'close <pool>', 'settle <rideId> <sponsor>', 'refund <rideId> <sponsor>' */
  readonly calls: string[] = [];
  /** rides whose record_ride_attestation fails (an RPC error) */
  readonly failingAttestations = new Set<string>();
  /** reads of rideAttestationOf */
  attestationReads = 0;

  constructor(private readonly chain: FakePoolChain) { super(); }

  /** back to no key and an empty chain record (the harness's reset) */
  reset(): void {
    this.payoutAddress = null; this.named = undefined; this.now = new Date(0); this.minReviewMs = 0;
    this.failing.clear(); this.dropping.clear(); this.prizes.length = 0; this.closed.length = 0; this.attestations.clear(); this.calls.length = 0;
    this.failingAttestations.clear(); this.attestationReads = 0;
  }

  get address(): string | null { return this.payoutAddress; }
  async chainNow(): Promise<Date> { return this.now; }
  async configuredPayoutAuthority(): Promise<string | null> { return this.named === undefined ? this.payoutAddress : this.named; }

  /** max(payout_at, at + max(payout_at − play_deadline, min_review)) – state.rs `pay_from` */
  private payFromOf(poolId: number, at: Date): Date {
    const p = this.chain.pools.get(poolId)!;
    const lock = Math.max(p.payoutAt.getTime() - p.playDeadline.getTime(), this.minReviewMs);
    return new Date(Math.max(p.payoutAt.getTime(), at.getTime() + lock));
  }

  async commitWinners(i: { poolId: number; root: Uint8Array; total: number; count: number }): Promise<{ signature: string }> {
    if (!this.payoutAddress) throw new ServiceUnavailableError('no payout key');
    const pool = this.chain.pools.get(i.poolId);
    const refuse = (why: string) => new ConflictError(`commit_winners pool ${i.poolId} would fail: ${why}`, 'transaction_would_fail');
    if (!pool || pool.status !== 'active') throw refuse('PoolNotActive');
    if (this.now.getTime() < pool.playDeadline.getTime()) throw refuse('TooEarly');
    if (pool.winnersRoot) throw refuse('WinnersCommitted');
    if (this.failing.has('commit')) throw refuse('scripted');
    const root = Buffer.from(i.root).toString('base64');
    this.chain.pools.set(i.poolId, { ...pool, winnersRoot: root, winnersTotal: i.total, winnersCount: i.count, committedAt: this.now, payFrom: this.payFromOf(i.poolId, this.now), paidMask: 0n });
    this.calls.push(`commit ${i.poolId} ${i.count}`);
    return { signature: this.chain.addTransaction([{ kind: 'WinnersCommitted', poolId: i.poolId, root, total: i.total, count: i.count, committedAt: this.now, payFrom: this.payFromOf(i.poolId, this.now), by: this.payoutAddress }]) };
  }

  async payPrize(i: { poolId: number; rank: number; to: string; lamports: number; proof: Uint8Array[] }, onSigned: (tx: SignedPayout) => Promise<void>): Promise<{ signature: string }> {
    if (!this.payoutAddress) throw new ServiceUnavailableError('no payout key');
    const pool = this.chain.pools.get(i.poolId);
    const refuse = (why: string) => new ConflictError(`pay_prize #${i.rank} of pool ${i.poolId} would fail: ${why}`, 'transaction_would_fail');
    if (!pool || pool.status !== 'active') throw refuse('PoolNotActive');
    if (!pool.winnersRoot || !pool.payFrom) throw refuse('WinnersNotCommitted');
    if (this.now.getTime() < pool.payFrom.getTime()) throw refuse('TooEarly');
    if (this.failing.has(String(i.rank))) throw refuse('scripted');
    const bit = 1n << BigInt(i.rank - 1);
    if ((pool.paidMask ?? 0n) & bit) throw refuse('RankAlreadyPaid');
    const root = rootFromProof(winnerLeaf(i.poolId, i.rank - 1, { wallet: i.to, lamports: i.lamports }, sha), i.rank - 1, pool.winnersCount ?? 0, i.proof, sha);
    if (!root || root.toString('base64') !== pool.winnersRoot) throw refuse('InvalidProof');
    const signature = newPoolSignature();
    await onSigned({ signature, lastValidBlockHeight: this.chain.lastValidBlockHeight });
    if (this.dropping.has(i.rank)) { this.dropping.delete(i.rank); this.chain.statuses.set(signature, 'expired'); throw new ConflictError(`pay_prize #${i.rank} was dropped`, 'transaction_dropped'); }
    const prizesPaid = pool.prizesPaid + i.lamports;
    this.chain.pools.set(i.poolId, { ...pool, prizesPaid, paidMask: (pool.paidMask ?? 0n) | bit, vaultLamports: pool.vaultLamports - i.lamports, escrowLamports: pool.escrowLamports - i.lamports });
    this.chain.addTransaction([{ kind: 'PrizePaid', poolId: i.poolId, to: i.to, lamports: i.lamports, rank: i.rank - 1, prizesPaidTotal: prizesPaid }], signature);
    this.chain.statuses.set(signature, 'confirmed');
    this.prizes.push({ poolId: i.poolId, to: i.to, lamports: i.lamports, rank: i.rank, signature });
    this.calls.push(`prize ${i.poolId} ${i.rank}`);
    return { signature };
  }

  async closePool(poolId: number): Promise<{ signature: string }> {
    const pool = this.chain.pools.get(poolId);
    if (!pool || pool.status !== 'active' || this.failing.has('close')) throw new ConflictError(`close_pool ${poolId} would fail`, 'transaction_would_fail');
    const n = pool.winnersCount ?? 0, full = n >= 64 ? (1n << 64n) - 1n : (1n << BigInt(n)) - 1n;
    if (!pool.committedAt) throw new ConflictError(`close_pool ${poolId} would fail: WinnersNotCommitted`, 'transaction_would_fail');
    if (((pool.paidMask ?? 0n) & full) !== full) throw new ConflictError(`close_pool ${poolId} would fail: PrizesUnpaid`, 'transaction_would_fail');
    this.chain.pools.set(poolId, { ...pool, status: 'settled', vaultLamports: 0, escrowLamports: 0 });
    this.closed.push(poolId);
    this.calls.push(`close ${poolId}`);
    return { signature: this.chain.addTransaction([{ kind: 'PoolClosed', poolId, prizePaid: pool.prizesPaid, seed: 0, fee: 0, platformFee: 0, unclaimed: 0, rentReturned: 890_880, cancelled: false }]) };
  }

  async rideAttestationOf(poolId: number, rideId: string): Promise<RideAttestationState | null> {
    this.attestationReads++;
    const a = this.attestations.get(`${poolId}:${rideId}`);
    return a ? { driver: a.driver, status: a.status, verifiedKm: a.verifiedKm, settleFrom: a.settleFrom, settledPledges: a.settledPledges } : null;
  }

  async recordRideAttestation(i: { poolId: number; rideId: string; driver: string; telemetryRoot: Uint8Array | Buffer; verifiedKm: number; status: number }): Promise<{ signature: string }> {
    if (this.failingAttestations.has(i.rideId)) throw new ServiceUnavailableError(`record_ride_attestation for ${i.rideId}: RPC unavailable`);
    const pool = this.chain.pools.get(i.poolId);
    if (pool && pool.status !== 'active') throw new ConflictError(`record_ride_attestation pool ${i.poolId} would fail: PoolNotActive`, 'transaction_would_fail');
    const key = `${i.poolId}:${i.rideId}`, was = this.attestations.get(key);
    if (was && was.settledPledges > 0) throw new ConflictError(`record_ride_attestation ${i.rideId} would fail: AttestationFinal`, 'transaction_would_fail');
    this.attestations.set(key, { driver: i.driver, telemetryRoot: i.telemetryRoot, verifiedKm: i.verifiedKm, status: i.status, settleFrom: pool ? this.payFromOf(i.poolId, this.now) : this.now, settledPledges: 0 });
    this.calls.push(`attest ${i.poolId} ${i.rideId} ${i.status}`);
    return { signature: newPoolSignature() };
  }

  async settlePledge(k: PledgeKeys): Promise<{ signature: string }> {
    if (!this.payoutAddress) throw new ServiceUnavailableError('no payout key');
    const acc = this.chain.pledgeAccounts.get(this.chain.pledgePda(rideIdToBytes(k.rideId), k.sponsor));
    if (!acc) throw new ConflictError(`settle_pledge ride ${k.rideId} would fail: AccountNotInitialized`, 'transaction_would_fail');
    const att = this.attestations.get(`${k.poolId}:${k.rideId}`);
    if (!att || (att.status !== ATTESTATION_VERIFIED && att.status !== ATTESTATION_FLAGGED)) throw new ConflictError(`settle_pledge ride ${k.rideId} would fail: UnverifiedAttestation`, 'transaction_would_fail');
    if (att.driver !== k.driver) throw new ConflictError(`settle_pledge ride ${k.rideId} would fail: AttestationMismatch`, 'transaction_would_fail');
    if (this.now.getTime() < att.settleFrom.getTime()) throw new ConflictError(`settle_pledge ride ${k.rideId} would fail: TooEarly`, 'transaction_would_fail');
    const km = att.status === ATTESTATION_FLAGGED ? 0 : att.verifiedKm;
    const earned = (acc.maxLamports * BigInt(Math.min(km, acc.targetKm))) / BigInt(acc.targetKm);
    att.settledPledges++;
    this.calls.push(`settle ${k.rideId} ${k.sponsor}`);
    const signature = this.chain.addPledgeTransaction([{ kind: 'PledgeSettled', rideId: acc.rideId, sponsor: acc.sponsor, driver: acc.driver, pool: acc.pool, verifiedKm: km, earnedLamports: earned, refundedLamports: acc.maxLamports - earned }]);
    return { signature };
  }

  async refundPledge(k: PledgeKeys): Promise<{ signature: string }> {
    if (!this.payoutAddress) throw new ServiceUnavailableError('no payout key');
    const acc = this.chain.pledgeAccounts.get(this.chain.pledgePda(rideIdToBytes(k.rideId), k.sponsor));
    if (!acc) throw new ConflictError(`refund_pledge ride ${k.rideId} would fail: AccountNotInitialized`, 'transaction_would_fail');
    const att = this.attestations.get(`${k.poolId}:${k.rideId}`);
    if (att && att.driver === k.driver && (att.status === ATTESTATION_VERIFIED || att.status === ATTESTATION_FLAGGED)) throw new ConflictError(`refund_pledge ride ${k.rideId} would fail: AttestationExists`, 'transaction_would_fail');
    this.calls.push(`refund ${k.rideId} ${k.sponsor}`);
    const signature = this.chain.addPledgeTransaction([{ kind: 'PledgeRefunded', rideId: acc.rideId, sponsor: acc.sponsor, driver: acc.driver, pool: acc.pool, refundedLamports: acc.maxLamports }]);
    return { signature };
  }
}
