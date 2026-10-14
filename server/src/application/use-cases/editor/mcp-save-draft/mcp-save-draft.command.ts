/** The MCP's save_draft for a job: a draft on the current head, authored by the job's wallet, with the job's id. */
export class McpSaveDraftCommand {
  constructor(
    public readonly jobId: string,
    public readonly entityId: string,
    public readonly source: string,
    public readonly message: string,
  ) {}
}
