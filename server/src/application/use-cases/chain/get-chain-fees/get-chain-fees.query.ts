/** What a ticket purchase costs on the network right now – for pool `poolId` (its Pool + vault are the hot accounts), or in general (null). */
export class GetChainFeesQuery {
  constructor(readonly poolId: number | null = null) {}
}
