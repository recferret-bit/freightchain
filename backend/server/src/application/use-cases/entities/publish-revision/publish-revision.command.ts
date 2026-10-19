export type { PublishedDto } from '../../../../domain/entities/entity.dto.js';

/** Step 2: the signed publish – from now on every player draws this revision. */
export class PublishRevisionCommand {
  constructor(
    public readonly wallet: string,
    public readonly entityId: string,
    public readonly revisionId: string,
    public readonly signature: string,
    public readonly requestId: string | null,
  ) {}
}
