/** A request to the AI model editor (docs/spec/platform_services.md POST /api/editor/jobs). */
export class CreateEditorJobCommand {
  constructor(
    public readonly wallet: string,
    public readonly prompt: string,
    public readonly entityId: string | null,
    /** undefined = not checked; null = "the seed / nothing in the database yet" */
    public readonly baseRevisionId: string | null | undefined,
    public readonly provider: string | undefined,
    public readonly model: string | undefined,
  ) {}
}

export interface JobCreatedDto {
  jobId: string;
}
