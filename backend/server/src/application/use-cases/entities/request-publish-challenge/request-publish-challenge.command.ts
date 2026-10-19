/** Step 1 of a publish: the text naming the entity and the revision, for the editor's wallet to sign. */
export class RequestPublishChallengeCommand {
  constructor(
    public readonly wallet: string,
    public readonly entityId: string,
    public readonly revisionId: string,
  ) {}
}
