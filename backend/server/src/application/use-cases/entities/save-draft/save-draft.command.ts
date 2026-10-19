/** The editor saves a new HEAD of an entity (a hand edit of its file): validated, append-only, never published by itself. */
export class SaveDraftCommand {
  constructor(
    public readonly wallet: string,
    public readonly entityId: string,
    public readonly source: string,
    public readonly message: string,
    public readonly baseRevisionId: string | null,
  ) {}
}
