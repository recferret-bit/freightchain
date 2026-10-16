/** The newest jobs (≤ 50), of one entity when given. */
/** The signed-in editor's newest jobs (≤ 50), of one entity when given. */
export class ListEditorJobsQuery {
  constructor(public readonly wallet: string, public readonly entityId: string | null) {}
}
