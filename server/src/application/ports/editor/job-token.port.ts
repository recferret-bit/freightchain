/** A job's capability token for the MCP callbacks (aud mcp-job, short-lived): whoever holds it acts as that job, nothing more. */
export interface JobClaims {
  jobId: string;
  wallet: string;
  entityId: string | null;
}

export abstract class JobTokenPort {
  abstract sign(claims: JobClaims): Promise<string>;
  /** the claims of a valid, unexpired job token; null otherwise */
  abstract verify(token: string): Promise<JobClaims | null>;
}
