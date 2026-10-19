export interface PaymentProps {
  signature: string;
  rideId: string;
  wallet: string;
  /** what was ordered (the verified transfer was at least this) */
  lamports: number;
  usd: number;
  roundId: number;
  at: Date;
}

/** The on-chain payment of one ride: the transaction signature is unique, so one transaction can pay for exactly one ride. */
export class Payment {
  constructor(private readonly p: PaymentProps) {}

  get signature(): string { return this.p.signature; }
  get rideId(): string { return this.p.rideId; }
  get wallet(): string { return this.p.wallet; }
  get lamports(): number { return this.p.lamports; }
  get usd(): number { return this.p.usd; }
  get roundId(): number { return this.p.roundId; }
  get at(): Date { return this.p.at; }
}
