/** A job's events after `after` (the chat polls this about once a second). */
export class GetEditorJobEventsQuery {
  constructor(public readonly jobId: string, public readonly after: number) {}
}
