import { BadRequestError, ConflictError } from '../shared/errors.js';
import type { PledgeChainEvent, PledgeProps, PledgeStatus } from './pledge.types.js';

/**
 * The mirror of one Pledge account (programs/freightchain_pools/src/instructions/pledge.rs). The money never moves here: the sponsor's wallet sends create_pledge, the payout
 * key (or anyone) sends settle_pledge / refund_pledge, and this row only follows the program's events – it never computes a payout of its own.
 */
export class Pledge {
  private constructor(private readonly p: PledgeProps) {}

  static create(i: {
    id: string;
    pdaAddress: string;
    rideId: string;
    sponsor: string;
    driver: string;
    poolId: number;
    lamportsPerKm: bigint;
    targetKm: number;
    now: Date;
    blockhash?: string | null;
  }): Pledge {
    if (i.sponsor === i.driver) throw new BadRequestError('sponsor cannot be driver');
    if (!Number.isInteger(i.targetKm) || i.targetKm <= 0) throw new BadRequestError('targetKm must be a positive integer');
    if (i.lamportsPerKm <= 0n) throw new BadRequestError('lamportsPerKm must be positive');
    return new Pledge({
      id: i.id, pdaAddress: i.pdaAddress, rideId: i.rideId, sponsor: i.sponsor, driver: i.driver, poolId: i.poolId,
      maxLamports: i.lamportsPerKm * BigInt(i.targetKm), lamportsPerKm: i.lamportsPerKm, targetKm: i.targetKm,
      status: 'pending', createSignature: null, settled: false, earnedLamports: 0n, refundedLamports: 0n,
      createdAt: i.now, settledAt: null, signature: null, slot: null, blockhash: i.blockhash ?? null,
    });
  }

  static restore(props: PledgeProps): Pledge {
    return new Pledge({ ...props });
  }

  get props(): PledgeProps { return this.p; }
  get id(): string { return this.p.id; }
  get pdaAddress(): string { return this.p.pdaAddress; }
  get rideId(): string { return this.p.rideId; }
  get sponsor(): string { return this.p.sponsor; }
  get driver(): string { return this.p.driver; }
  get poolId(): number { return this.p.poolId; }
  get maxLamports(): bigint { return this.p.maxLamports; }
  get lamportsPerKm(): bigint { return this.p.lamportsPerKm; }
  get targetKm(): number { return this.p.targetKm; }
  get status(): PledgeStatus { return this.p.status; }
  get createSignature(): string | null { return this.p.createSignature; }
  get isSettled(): boolean { return this.p.settled; }
  get earnedLamports(): bigint { return this.p.earnedLamports; }
  get refundedLamports(): bigint { return this.p.refundedLamports; }
  get createdAt(): Date { return this.p.createdAt; }
  get settledAt(): Date | null { return this.p.settledAt; }
  get signature(): string | null { return this.p.signature; }
  get slot(): bigint | null { return this.p.slot; }
  get blockhash(): string | null { return this.p.blockhash ?? null; }

  snapshot(): PledgeProps {
    return { ...this.p };
  }

  /** an event of THIS pledge: same ride, sponsor and driver */
  matches(e: PledgeChainEvent): boolean {
    return e.rideId === this.p.rideId && e.sponsor === this.p.sponsor && e.driver === this.p.driver;
  }

  /**
   * Applies one program event; false = nothing changed (already applied, or a later state is recorded). A PledgeCreated whose terms differ from the row's
   * is refused – the row would lie about the money on chain.
   */
  apply(e: PledgeChainEvent, now: Date): boolean {
    if (!this.matches(e)) throw new ConflictError(`event of another pledge (ride ${e.rideId}, sponsor ${e.sponsor})`, 'pledge_mismatch');
    if (e.kind === 'PledgeCreated') {
      if (e.maxLamports !== this.p.maxLamports || e.lamportsPerKm !== this.p.lamportsPerKm || e.targetKm !== this.p.targetKm) {
        throw new ConflictError('the pledge on chain has other terms than this one', 'pledge_terms_differ');
      }
      if (this.p.status !== 'pending' && this.p.status !== 'abandoned') return false;
      this.p.status = 'active';
      this.p.createSignature = e.signature;
      return true;
    }
    if (this.p.settled) return false;
    const earned = e.kind === 'PledgeSettled' ? e.earnedLamports : 0n;
    if (earned + e.refundedLamports !== this.p.maxLamports) throw new RangeError(`pledge ${this.p.id}: ${earned} + ${e.refundedLamports} ≠ ${this.p.maxLamports}`);
    this.p.status = e.kind === 'PledgeSettled' ? 'settled' : 'refunded';
    this.p.settled = true;
    this.p.earnedLamports = earned;
    this.p.refundedLamports = e.refundedLamports;
    this.p.settledAt = now;
    this.p.signature = e.signature;
    this.p.slot = BigInt(e.slot);
    return true;
  }

  /** built but never signed: no account on chain long after it was built */
  abandon(): void {
    if (this.p.status === 'pending') this.p.status = 'abandoned';
  }
}
