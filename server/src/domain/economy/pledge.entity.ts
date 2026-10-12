import { BadRequestError, ConflictError } from '../shared/errors.js';
import type { PledgeProps } from './pledge.types.js';

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
    if (i.targetKm <= 0) throw new BadRequestError('targetKm must be positive');
    if (i.lamportsPerKm <= 0n) throw new BadRequestError('lamportsPerKm must be positive');

    const maxLamports = i.lamportsPerKm * BigInt(i.targetKm);

    return new Pledge({
      id: i.id,
      pdaAddress: i.pdaAddress,
      rideId: i.rideId,
      sponsor: i.sponsor,
      driver: i.driver,
      poolId: i.poolId,
      maxLamports,
      lamportsPerKm: i.lamportsPerKm,
      targetKm: i.targetKm,
      settled: false,
      earnedLamports: 0n,
      refundedLamports: 0n,
      createdAt: i.now,
      settledAt: null,
      signature: null,
      slot: null,
      blockhash: i.blockhash ?? null,
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

  /**
   * Settles the pledge based on verified kilometers or flagged status.
   * Enforces the mathematical conservation invariant: earnedLamports + refundedLamports === maxLamports.
   */
  settle(
    verifiedKm: number,
    isFlagged: boolean,
    now: Date,
    signature?: string | null,
    slot?: bigint | null,
  ): { earnedLamports: bigint; refundedLamports: bigint } {
    if (this.p.settled) throw new ConflictError('pledge already settled');

    let earned: bigint;
    let refund: bigint;

    if (isFlagged) {
      earned = 0n;
      refund = this.p.maxLamports;
    } else {
      const effectiveKm = Math.min(Math.max(0, verifiedKm), this.p.targetKm);
      earned = (this.p.maxLamports * BigInt(effectiveKm)) / BigInt(this.p.targetKm);
      refund = this.p.maxLamports - earned;
    }

    // Mathematical conservation assertion
    if (earned + refund !== this.p.maxLamports) {
      throw new RangeError(`Lamport conservation invariant violated: ${earned} + ${refund} !== ${this.p.maxLamports}`);
    }

    this.p.settled = true;
    this.p.earnedLamports = earned;
    this.p.refundedLamports = refund;
    this.p.settledAt = now;
    if (signature !== undefined) this.p.signature = signature;
    if (slot !== undefined) this.p.slot = slot;

    return { earnedLamports: earned, refundedLamports: refund };
  }
}
