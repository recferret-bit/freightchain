/** Fail AI editor jobs nobody runs any more (`all` = on boot: every open job is an orphan of the last process). */
export class SweepEditorJobsCommand {
  constructor(public readonly all = false) {}
}

export interface SweepEditorJobsResultDto {
  failed: number;
}
