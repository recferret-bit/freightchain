import { Injectable } from '@nestjs/common';
import { EditorJobRepositoryPort } from '../../../src/application/ports/editor/editor-job.repository.port.js';
import type { EditorJobRecord, JobEventRecord, JobEventType, JobStatus } from '../../../src/domain/editor/editor-job.js';
import type { MemoryDb } from './memory-db.js';

/** asset.EditorJob / EditorJobEvent in memory (the prompts also feed the entity revision list, like the SQL join). */
@Injectable()
export class MemoryEditorJobRepository extends EditorJobRepositoryPort {
  constructor(private readonly db: MemoryDb) { super(); }

  async insert(j: EditorJobRecord): Promise<void> { this.db.editorJobs.set(j.id, { ...j }); this.db.editorJobPrompts.set(j.id, j.prompt); }
  async find(id: string): Promise<EditorJobRecord | null> { const j = this.db.editorJobs.get(id); return j ? { ...j } : null; }
  async list({ wallet, entityId, limit }: { wallet?: string; entityId?: string; limit: number }): Promise<EditorJobRecord[]> {
    return [...this.db.editorJobs.values()].filter((j) => (!wallet || j.wallet === wallet) && (!entityId || j.entityId === entityId))
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime() || (a.id < b.id ? 1 : -1)).slice(0, limit).map((j) => ({ ...j }));
  }
  async update(id: string, patch: Partial<EditorJobRecord>, from?: readonly JobStatus[]): Promise<boolean> {
    const j = this.db.editorJobs.get(id); if (!j || (from && !from.includes(j.status))) return false;
    Object.assign(j, patch); return true;
  }
  async addUsage(id: string, tokensIn: number, tokensOut: number): Promise<void> { const j = this.db.editorJobs.get(id); if (j) { j.tokensIn += tokensIn; j.tokensOut += tokensOut; } }
  async appendEvent(jobId: string, type: JobEventType, payload: Record<string, unknown>, at: Date): Promise<JobEventRecord> {
    const list = this.db.editorJobEvents.get(jobId) ?? [], e = { jobId, seq: list.length + 1, type, payload: structuredClone(payload), at };
    list.push(e); this.db.editorJobEvents.set(jobId, list); return e;
  }
  async events(jobId: string, after: number, limit: number): Promise<JobEventRecord[]> { return (this.db.editorJobEvents.get(jobId) ?? []).filter((e) => e.seq > after).slice(0, limit).map((e) => structuredClone(e)); }
  async countSince(wallet: string, since: Date): Promise<number> { return [...this.db.editorJobs.values()].filter((j) => j.wallet === wallet && j.createdAt >= since).length; }
  async open(): Promise<EditorJobRecord[]> { return [...this.db.editorJobs.values()].filter((j) => j.status === 'queued' || j.status === 'running').map((j) => ({ ...j })); }
}
