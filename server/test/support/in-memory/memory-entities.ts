import { Injectable } from '@nestjs/common';
import { EntityRepositoryPort } from '../../../src/application/ports/entities/entity.repository.port.js';
import type { EntityRecord, RevisionRecord, RevisionSummary } from '../../../src/domain/entities/entity.js';
import type { MemoryDb } from './memory-db.js';

/** asset.Entity + asset.EntityRevision in memory (no row lock: the Postgres suite has the concurrency test). */
@Injectable()
export class MemoryEntityRepository extends EntityRepositoryPort {
  constructor(private readonly db: MemoryDb) { super(); }

  private copy = (e: EntityRecord & { publishedAt: Date | null }): EntityRecord => {
    const { publishedAt: _p, ...rest } = e; return { ...rest };
  };

  async list(): Promise<EntityRecord[]> { return [...this.db.entities.values()].sort((a, b) => (a.id < b.id ? -1 : 1)).map(this.copy); }
  async find(id: string): Promise<EntityRecord | null> { const e = this.db.entities.get(id); return e ? this.copy(e) : null; }
  async ensure(e: EntityRecord): Promise<void> { if (!this.db.entities.has(e.id)) this.db.entities.set(e.id, { ...e, publishedAt: null }); }
  async lock(id: string): Promise<EntityRecord | null> { return this.find(id); }
  async appendRevision(r: RevisionRecord): Promise<void> {
    if (this.db.entityRevisions.some((x) => x.entityId === r.entityId && x.seq === r.seq)) throw new Error('unique (entityId, seq)');
    this.db.entityRevisions.push(structuredClone(r));
  }
  async nextSeq(entityId: string): Promise<number> { return Math.max(0, ...this.db.entityRevisions.filter((r) => r.entityId === entityId).map((r) => r.seq)) + 1; }
  async setPointers(id: string, p: { headRevisionId?: string; publishedRevisionId?: string }, at: Date): Promise<void> {
    const e = this.db.entities.get(id); if (!e) return;
    if (p.headRevisionId) e.headRevisionId = p.headRevisionId;
    if (p.publishedRevisionId) { e.publishedRevisionId = p.publishedRevisionId; e.publishedAt = at; }
    e.updatedAt = at; e.version++;
  }
  async revision(id: string): Promise<RevisionRecord | null> { const r = this.db.entityRevisions.find((x) => x.id === id); return r ? structuredClone(r) : null; }
  async revisions(entityId: string): Promise<RevisionSummary[]> {
    return this.db.entityRevisions.filter((r) => r.entityId === entityId).sort((a, b) => b.seq - a.seq)
      .map(({ source: _s, config: _c, ...r }) => ({ ...r, prompt: r.jobId ? this.db.editorJobPrompts.get(r.jobId) ?? null : null }));
  }
  async seqs(ids: readonly string[]): Promise<Map<string, number>> { return new Map(this.db.entityRevisions.filter((r) => ids.includes(r.id)).map((r) => [r.id, r.seq])); }
  async heads(): Promise<RevisionRecord[]> { return this.pointed((e) => e.headRevisionId); }
  async published(): Promise<RevisionRecord[]> { return this.pointed((e) => e.publishedRevisionId); }
  async publishedStamp(): Promise<string> {
    const pub = [...this.db.entities.values()].filter((e) => e.publishedRevisionId);
    const max = pub.reduce<Date | null>((m, e) => (e.publishedAt && (!m || e.publishedAt > m) ? e.publishedAt : m), null);
    return `${pub.length}:${max?.toISOString() ?? '-'}:${pub.map((e) => e.publishedRevisionId).join(',')}`;
  }
  private pointed(f: (e: EntityRecord) => string | null): RevisionRecord[] {
    const ids = new Set([...this.db.entities.values()].map(f).filter((v): v is string => !!v));
    return this.db.entityRevisions.filter((r) => ids.has(r.id)).map((r) => structuredClone(r));
  }
}
