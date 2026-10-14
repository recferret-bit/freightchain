import type { EditorJobRecord, JobEventRecord, JobEventType, JobStatus } from '../../../domain/editor/editor-job.js';

/** `asset.EditorJob` + `asset.EditorJobEvent`: jobs and their append-only events (seq 1, 2, … per job). */
export abstract class EditorJobRepositoryPort {
  abstract insert(job: EditorJobRecord): Promise<void>;
  abstract find(id: string): Promise<EditorJobRecord | null>;
  /** newest first */
  abstract list(filter: { wallet?: string; entityId?: string; limit: number }): Promise<EditorJobRecord[]>;
  /** status / result fields; `from` = only when the job is still in one of these statuses (true when it moved) */
  abstract update(id: string, patch: Partial<Pick<EditorJobRecord, 'status' | 'error' | 'resultRevisionId' | 'startedAt' | 'finishedAt' | 'tokensIn' | 'tokensOut'>>, from?: readonly JobStatus[]): Promise<boolean>;
  abstract addUsage(id: string, tokensIn: number, tokensOut: number): Promise<void>;
  /** appends with the next seq (unique per job) */
  abstract appendEvent(jobId: string, type: JobEventType, payload: Record<string, unknown>, at: Date): Promise<JobEventRecord>;
  abstract events(jobId: string, after: number, limit: number): Promise<JobEventRecord[]>;
  /** jobs of a wallet created since `since` (the daily cap) */
  abstract countSince(wallet: string, since: Date): Promise<number>;
  /** queued / running jobs (one per wallet and per entity) */
  abstract open(): Promise<EditorJobRecord[]>;
}
