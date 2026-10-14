/* One request to the AI model editor (docs/agents/editor.md): the prompt, the provider and model, what it produced and what it cost, and its steps as
   append-only events (seq per job) that the editor's chat polls. A job writes models only through the MCP callbacks, as drafts. */

export const JOB_STATUSES = ['queued', 'running', 'done', 'failed', 'cancelled'] as const;
export type JobStatus = (typeof JOB_STATUSES)[number];
export const OPEN_STATUSES: readonly JobStatus[] = ['queued', 'running'];
export const EVENT_TYPES = ['status', 'text', 'tool_call', 'tool_result', 'draft', 'usage', 'error', 'done'] as const;
export type JobEventType = (typeof EVENT_TYPES)[number];

export const MAX_PROMPT = 4000;
/** an event payload's text is clipped to this (a tool result can be a whole entity file) */
export const MAX_EVENT_TEXT = 4000;

export interface EditorJobRecord {
  id: string;
  wallet: string;
  prompt: string;
  provider: string;
  model: string;
  entityId: string | null;
  baseRevisionId: string | null;
  resultRevisionId: string | null;
  status: JobStatus;
  error: string | null;
  tokensIn: number;
  tokensOut: number;
  createdAt: Date;
  startedAt: Date | null;
  finishedAt: Date | null;
}

export interface JobEventRecord {
  jobId: string;
  seq: number;
  type: JobEventType;
  payload: Record<string, unknown>;
  at: Date;
}

export interface EditorJobDto {
  id: string;
  wallet: string;
  prompt: string;
  provider: string;
  model: string;
  entityId: string | null;
  baseRevisionId: string | null;
  resultRevisionId: string | null;
  status: JobStatus;
  error: string | null;
  tokensIn: number;
  tokensOut: number;
  createdAt: string;
  finishedAt: string | null;
}

export interface JobEventDto {
  seq: number;
  type: JobEventType;
  payload: Record<string, unknown>;
  at: string;
}

export interface JobEventsDto {
  status: JobStatus;
  events: JobEventDto[];
}

export const jobDto = (j: EditorJobRecord): EditorJobDto => ({
  id: j.id, wallet: j.wallet, prompt: j.prompt, provider: j.provider, model: j.model, entityId: j.entityId, baseRevisionId: j.baseRevisionId, resultRevisionId: j.resultRevisionId,
  status: j.status, error: j.error, tokensIn: j.tokensIn, tokensOut: j.tokensOut, createdAt: j.createdAt.toISOString(), finishedAt: j.finishedAt?.toISOString() ?? null,
});
export const eventDto = (e: JobEventRecord): JobEventDto => ({ seq: e.seq, type: e.type, payload: e.payload, at: e.at.toISOString() });

/** a tool result / model text for the chat: one line of at most `max` characters */
export const clip = (text: string, max = MAX_EVENT_TEXT): string => (text.length > max ? `${text.slice(0, max - 1)}…` : text);

/** what a job may write: the entity it was opened on, or a NEW part entity (a sub-assembly it adds); a job without an entity may write anything new or existing */
export function mayWrite(job: Pick<EditorJobRecord, 'entityId'>, targetId: string, target: { exists: boolean; kind: string | null }): boolean {
  if (!job.entityId || targetId === job.entityId) return true;
  return !target.exists && target.kind === 'part';
}
