/** A signed admin run of the sanctions screening for one event wallet (`AdminIntent` event_sanctions). */
export class CheckEventSanctionsCommand {
  constructor(public readonly admin: string, public readonly wallet: string, public readonly requestId: string | null, public readonly signature: string) {}
}
