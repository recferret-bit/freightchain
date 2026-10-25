export interface ReferralSubmission { signature: string; lastValidBlockHeight: number }
export type ReferralSettlement = { kind: 'paid'; amount: bigint } | { kind: 'capped'; reason: 'emission' | 'monthly' | 'wallet' };
export interface ReferralPayment {
  rewardId: string;
  wallet: string;
  baseAmount: bigint;
  now: Date;
  submitted: ReferralSubmission | null;
  /** Must persist under the worker's lease before any broadcast. */
  onSubmitted: (submission: ReferralSubmission) => Promise<void>;
}

export abstract class ReferralEmissionPort {
  abstract enabled(): boolean;
  abstract settle(payment: ReferralPayment): Promise<ReferralSettlement>;
}
