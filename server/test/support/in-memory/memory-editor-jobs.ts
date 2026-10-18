import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { EditorJobRepositoryPort } from '../../../src/application/ports/editor/editor-job.repository.port.js';
import type { EditorJobRecord, EditorMcpCallInput, EditorMcpCallRecord, JobEventRecord, JobEventType, JobStatus } from '../../../src/domain/editor/editor-job.js';
import type { MemoryDb } from './memory-db.js';

/** asset.EditorJob / EditorJobEvent in memory (the prompts also feed the entity revision list, like the SQL join). */
@Injectable()
export class MemoryEditorJobRepository extends EditorJobRepositoryPort {
  constructor(private readonly db: MemoryDb) { super(); }

  async admit(job: EditorJobRecord, since: Date, dailyCap: number): Promise<'accepted' | 'job_cap' | 'job_running'> {
    const rows = [...this.db.editorJobs.values()];
    if (rows.filter(j => j.wallet === job.wallet && j.createdAt >= since).length >= dailyCap) return 'job_cap';
    if (rows.some(j => ['queued', 'running'].includes(j.status) && (j.wallet === job.wallet || (job.entityId && j.entityId === job.entityId)))) return 'job_running';
    this.db.editorJobs.set(job.id, { ...job }); this.db.editorJobPrompts.set(job.id, job.prompt);
    await this.appendEvent(job.id, 'status', { status: 'queued', provider: job.provider, model: job.model }, job.createdAt);
    return 'accepted';
  }
  async claim(parallel: number, now: Date, timeoutMs: number): Promise<EditorJobRecord | null> {
    const rows = [...this.db.editorJobs.values()];
    if (rows.filter(j => j.status === 'running').length >= parallel) return null;
    const row = rows.filter(j => j.status === 'queued' && j.createdAt.getTime() > now.getTime() - timeoutMs).sort((a,b) => a.createdAt.getTime() - b.createdAt.getTime() || a.id.localeCompare(b.id))[0];
    if (!row) return null;
    row.status = 'running'; row.startedAt = now;
    await this.appendEvent(row.id, 'status', { status: 'running', provider: row.provider, model: row.model }, now);
    return { ...row };
  }
  async conclude(id: string, status: 'done' | 'failed' | 'cancelled', error: string | null, at: Date): Promise<boolean> {
    const row = this.db.editorJobs.get(id);
    if (!row || !['queued', 'running'].includes(row.status)) return false;
    Object.assign(row, { status, error, finishedAt: at });
    await this.appendEvent(id, 'status', { status }, at);
    await this.appendEvent(id, status === 'done' ? 'done' : 'error', status === 'done' ? { status } : { status, message: error ?? status }, at);
    return true;
  }
  async expire(now: Date, timeoutMs: number): Promise<number> {
    let failed = 0;
    for (const row of this.db.editorJobs.values()) {
      if (!['queued', 'running'].includes(row.status)) continue;
      if (row.status === 'running' && !row.startedAt || now.getTime() - (row.startedAt ?? row.createdAt).getTime() >= timeoutMs) {
        if (await this.conclude(row.id, 'failed', row.status === 'queued' ? 'the job waited longer than the timeout (the AI editor is paused or busy)' : 'the server restarted or the job timed out', now)) failed++;
      }
    }
    return failed;
  }
  async insert(j: EditorJobRecord): Promise<void> { this.db.editorJobs.set(j.id, { ...j }); this.db.editorJobPrompts.set(j.id, j.prompt); }
  async find(id: string): Promise<EditorJobRecord | null> { const j = this.db.editorJobs.get(id); return j ? { ...j } : null; }
  async list({ wallet, entityId, limit }: { wallet?: string; entityId?: string; limit: number }): Promise<EditorJobRecord[]> {
    return [...this.db.editorJobs.values()].filter((j) => (!wallet || j.wallet === wallet) && (!entityId || j.entityId === entityId))
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime() || (a.id < b.id ? 1 : -1)).slice(0, limit).map((j) => ({ ...j }));
  }
  async update(id: string, patch: Partial<EditorJobRecord>, from?: readonly JobStatus[], _tx?: unknown): Promise<boolean> {
    const j = this.db.editorJobs.get(id); if (!j || (from && !from.includes(j.status))) return false;
    Object.assign(j, patch); return true;
  }
  async addUsage(id: string, tokensIn: number, tokensOut: number): Promise<void> { const j = this.db.editorJobs.get(id); if (j) { j.tokensIn += tokensIn; j.tokensOut += tokensOut; } }
  async lock(): Promise<void> { /* the Postgres row lock; memory runs one call at a time in these tests */ }
  async appendEvent(jobId: string, type: JobEventType, payload: Record<string, unknown>, at: Date, _tx?: unknown): Promise<JobEventRecord> {
    const list = this.db.editorJobEvents.get(jobId) ?? [], e = { jobId, seq: list.length + 1, type, payload: structuredClone(payload), at };
    list.push(e); this.db.editorJobEvents.set(jobId, list); return e;
  }
  async events(jobId: string, after: number, limit: number): Promise<JobEventRecord[]> { return (this.db.editorJobEvents.get(jobId) ?? []).filter((e) => e.seq > after).slice(0, limit).map((e) => structuredClone(e)); }
  async recordMcpCall(call: EditorMcpCallInput): Promise<EditorMcpCallRecord> {
    const list = this.db.editorMcpCalls.get(call.jobId) ?? [];
    const row: EditorMcpCallRecord = { ...call, id: randomUUID(), seq: list.length + 1, args: structuredClone(call.args) };
    list.push(row); this.db.editorMcpCalls.set(call.jobId, list); return structuredClone(row);
  }
  async mcpCalls(jobId: string): Promise<EditorMcpCallRecord[]> { return (this.db.editorMcpCalls.get(jobId) ?? []).map((r) => structuredClone(r)); }
  async createdIds(jobId: string): Promise<string[]> {
    const ids = (this.db.editorJobEvents.get(jobId) ?? []).filter((e) => e.type === 'draft').map((e) => (typeof e.payload['entityId'] === 'string' ? e.payload['entityId'] : ''));
    return [...new Set(ids.filter((id) => id.length > 0))];
  }
  async countSince(wallet: string, since: Date): Promise<number> { return [...this.db.editorJobs.values()].filter((j) => j.wallet === wallet && j.createdAt >= since).length; }
  async open(): Promise<EditorJobRecord[]> { return [...this.db.editorJobs.values()].filter((j) => j.status === 'queued' || j.status === 'running').map((j) => ({ ...j })); }
}
