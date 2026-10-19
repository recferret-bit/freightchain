/** A webhook delivery (QuickNode Streams / Helius): the transaction signatures it named – only those, never its event data. */
export class ReceiveChainWebhookCommand {
  constructor(public readonly signatures: readonly string[]) {}
}

export interface ChainWebhookResultDto {
  /** signatures in the delivery */
  received: number;
  /** settled (every event handled – also when it had been settled before) */
  settled: number;
  /** not visible at the configured commitment yet: the program watcher (or a re-delivery) settles them later */
  pending: number;
}
