/** One entity's HEAD: its file text and config (the seed printed, until it is first edited). */
export class GetEntityQuery {
  constructor(public readonly id: string) {}
}
