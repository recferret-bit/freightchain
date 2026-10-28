/** A signed admin change of the event prize table (`AdminIntent` event_prize_table), US cents, place 1 first. */
export class SetEventPrizeTableCommand {
  constructor(public readonly admin: string, public readonly cents: number[], public readonly requestId: string | null, public readonly signature: string) {}
}
