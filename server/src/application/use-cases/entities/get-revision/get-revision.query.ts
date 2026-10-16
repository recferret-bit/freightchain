/** One revision with its file text and config (the editor previews it without publishing). */
export class GetRevisionQuery {
  constructor(public readonly revisionId: string) {}
}
