/** Stop a job of this editor (a queued one never starts, a running one is aborted). */
export class CancelEditorJobCommand {
  constructor(public readonly wallet: string, public readonly jobId: string) {}
}
