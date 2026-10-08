/** Admin (CLI `pool:register <poolId> [--label TEXT]`): read the pool's account from chain once and put it into the mirror (or refresh it – the chain wins). */
export class RegisterPoolFromChainCommand {
  constructor(
    public readonly poolId: number,
    /** replaces the stored label; null keeps it (a new pool gets "<TIER> · pool <id>") */
    public readonly label: string | null = null,
  ) {}
}
