/** A signed admin review of one event wallet (`AdminIntent` event_review): disqualify, remove the prize by hand, a note. */
export class ReviewEventWalletCommand {
  constructor(
    public readonly admin: string,
    public readonly wallet: string,
    public readonly disqualified: boolean,
    public readonly prizeEligible: false | null,
    public readonly note: string | null,
    public readonly requestId: string | null,
    public readonly signature: string,
  ) {}
}
