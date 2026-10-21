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
  /** Solana Pay reference on the transfer memo. Null on an order from before reference keys. */
  paymentReference?: string | null;
  /** the driver's referrer, when this order reserved part of the tip */
  referrer?: string | null;
  /** lamports of the tip reserved for the referrer. 0 = the driver receives the whole price */
  shareLamports?: number;
  /** reserved until the transfer is claimed, then paid; released when the share was given back to the driver */
  shareState?: 'reserved' | 'paid' | 'released' | null;
}

/** A donation in flight when donations must be paid (LIVE_FREE_DONATIONS=off): a SOL transfer from the spectator to the DRIVER, priced from EFFECTS.
    It becomes a feed event only once the transfer is seen on chain. */
export class DonationOrder {
  private constructor(private readonly p: DonationOrderProps) {}

  static create(i: { id: string; rideId: string; wallet: string; recipient: string; effect: EffectId; note?: string | null; now: Date; lamports?: number }): DonationOrder {
    const note = i.note ? cleanText(i.note) : '';
    if (note.length > NOTE_MAX_LENGTH) throw new BadRequestError(`a donation note is at most ${NOTE_MAX_LENGTH} characters`, 'bad_message');
    return new DonationOrder({
      id: i.id, rideId: i.rideId, wallet: i.wallet, recipient: i.recipient, effect: i.effect, note: note || null, lamports: i.lamports ?? EFFECTS[i.effect].lamports,
      status: 'pending', signature: null, eventId: null, createdAt: i.now, paidAt: null, paymentReference: null, referrer: null, shareLamports: 0, shareState: null,
    });
  }

  static restore(props: DonationOrderProps): DonationOrder {
    return new DonationOrder({ ...props, paymentReference: props.paymentReference ?? null, referrer: props.referrer ?? null, shareLamports: props.shareLamports ?? 0, shareState: props.shareState ?? null });
  }

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
  get paymentReference(): string | null { return this.p.paymentReference ?? null; }
  get referrer(): string | null { return this.p.referrer ?? null; }
  get shareLamports(): number { return this.p.shareLamports ?? 0; }
  get shareState(): 'reserved' | 'paid' | 'released' | null { return this.p.shareState ?? null; }
  get createdAt(): Date { return this.p.createdAt; }

  /** Reserve `lamports` of this tip for the driver's referrer. The rest still goes to the driver. */
  assignShare(referrer: string, lamports: number): void {
    this.p.referrer = referrer;
    this.p.shareLamports = lamports;
    this.p.shareState = 'reserved';
  }

  /** The first build stores the reference. A rebuilt blockhash keeps it. */
  assignReference(reference: string): boolean {
    if (this.p.paymentReference) return false;
    this.p.paymentReference = reference;
    return true;
  }
  /** the memo the transfer must carry – ties the transfer to this order */
  get memo(): string { return `fc-donation:${this.p.id}`; }

  snapshot(): DonationOrderProps { return { ...this.p }; }
}

/** The spectator paid the referrer leg and the driver the rest. Independent of shareState: a release does not unsend a transfer. */
export function donationSplitLanded(tx: ChainTransaction, order: DonationOrder): boolean {
  const share = order.shareLamports;
  if (share <= 0 || !order.referrer) return false;
  const toDriver = tx.transfers.some((t) => t.source === order.wallet && t.destination === order.recipient && t.lamports >= order.lamports - share);
  const toReferrer = tx.transfers.some((t) => t.source === order.wallet && t.destination === order.referrer && t.lamports >= share);
  return toDriver && toReferrer;
}

/** null = the transaction pays this donation; otherwise why not (the 400's text). Scans every top-level instruction, like verifyPayment. */
export function verifyDonation(tx: ChainTransaction, order: DonationOrder): string | null {
  if (tx.outcome === 'no_metadata') return 'transaction has no metadata';
  if (tx.outcome === 'failed') return 'transaction failed on chain';
  if (!tx.feePayerSigned || tx.feePayer !== order.wallet) return 'not signed by your wallet';
  const fullPaid = tx.transfers.some((t) => t.source === order.wallet && t.destination === order.recipient && t.lamports >= order.lamports);
  // Reserved: the built transaction is the split. Anything else, including a share already given back, is one transfer of the whole price.
  if (!(order.shareState === 'reserved' ? donationSplitLanded(tx, order) : fullPaid)) return 'no transfer of the donation from your wallet to the driver';
  if (!tx.memos.includes(order.memo)) return 'the memo does not match this donation';
  if (order.paymentReference && !(tx.accountKeys ?? []).includes(order.paymentReference)) return 'the reference key is missing';
  return null;
}
