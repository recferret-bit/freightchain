/** A signed admin record of one manual USDC transfer (`AdminIntent` event_payout). No server key sends it. */
export class RecordEventPayoutCommand {
  constructor(public readonly admin: string, public readonly wallet: string, public readonly txSignature: string, public readonly requestId: string | null, public readonly signature: string) {}
}

export interface EventPayoutDto { wallet: string; place: number; amountCents: number; txSignature: string; solscanUrl: string }
