/** A new HEAD copying an older revision of the same entity (append-only). */
export class RestoreRevisionCommand {
  constructor(
    public readonly wallet: string,
    public readonly entityId: string,
    public readonly revisionId: string,
    public readonly baseRevisionId: string | null,
  ) {}
}
