import type { ChainTransaction } from '../economy/chain-transaction.js';
import { BadRequestError } from '../shared/errors.js';
import { EFFECTS, NOTE_MAX_LENGTH, type EffectId } from './live-rules.js';
import { cleanText } from './ride-event.entity.js';

export interface DonationOrderProps {
  id: string;
  rideId: string;
  wallet: string;
  recipient: string;
  effect: EffectId;
  note: string | null;
  lamports: number;
  status: 'pending' | 'paid';
  signature: string | null;
  eventId: number | null;
  createdAt: Date;
  paidAt: Date | null;
}

/** A donation in flight when donations must be paid (LIVE_FREE_DONATIONS=off): a SOL transfer from the spectator to the DRIVER, priced from EFFECTS.
    It becomes a feed event only once the transfer is seen on chain. */
export class DonationOrder {
  private constructor(private readonly p: DonationOrderProps) {}

  static create(i: { id: string; rideId: string; wallet: string; recipient: string; effect: EffectId; note?: string | null; now: Date }): DonationOrder {
    const note = i.note ? cleanText(i.note) : '';
    if (note.length > NOTE_MAX_LENGTH) throw new BadRequestError(`a donation note is at most ${NOTE_MAX_LENGTH} characters`, 'bad_message');
    return new DonationOrder({
      id: i.id, rideId: i.rideId, wallet: i.wallet, recipient: i.recipient, effect: i.effect, note: note || null, lamports: EFFECTS[i.effect].lamports,
      status: 'pending', signature: null, eventId: null, createdAt: i.now, paidAt: null,
    });
  }

  static restore(props: DonationOrderProps): DonationOrder { return new DonationOrder({ ...props }); }

  get id(): string { return this.p.id; }
  get rideId(): string { return this.p.rideId; }
  get wallet(): string { return this.p.wallet; }
  get recipient(): string { return this.p.recipient; }
  get effect(): EffectId { return this.p.effect; }
  get note(): string | null { return this.p.note; }
  get lamports(): number { return this.p.lamports; }
  get status(): 'pending' | 'paid' { return this.p.status; }
  get signature(): string | null { return this.p.signature; }
  get eventId(): number | null { return this.p.eventId; }
  /** the memo the transfer must carry – ties the transfer to this order */
  get memo(): string { return `fc-donation:${this.p.id}`; }

  snapshot(): DonationOrderProps { return { ...this.p }; }
}

/** null = the transaction pays this donation; otherwise why not (the 400's text). Scans every top-level instruction, like verifyPayment. */
export function verifyDonation(tx: ChainTransaction, order: DonationOrder): string | null {
  if (tx.outcome === 'no_metadata') return 'transaction has no metadata';
  if (tx.outcome === 'failed') return 'transaction failed on chain';
  if (!tx.feePayerSigned || tx.feePayer !== order.wallet) return 'not signed by your wallet';
  if (!tx.transfers.some((t) => t.source === order.wallet && t.destination === order.recipient && t.lamports >= order.lamports)) return 'no transfer of the donation from your wallet to the driver';
  if (!tx.memos.includes(order.memo)) return 'the memo does not match this donation';
  return null;
}
