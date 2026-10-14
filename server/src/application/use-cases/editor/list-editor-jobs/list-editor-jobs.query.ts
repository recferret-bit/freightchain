/** The newest jobs (≤ 50), of one entity when given. */
export class ListEditorJobsQuery {
  constructor(public readonly entityId: string | null) {}
}
