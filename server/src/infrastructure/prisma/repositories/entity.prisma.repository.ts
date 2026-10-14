import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { EntityRepositoryPort } from '../../../application/ports/entities/entity.repository.port.js';
import type { TransactionHandle } from '../../../application/ports/shared/transaction.port.js';
import type { EntityConfig, EntityRecord, RevisionRecord, RevisionSummary } from '../../../domain/entities/entity.js';
import { clientFor } from '../prisma-client.js';
import { PrismaService } from '../prisma.service.js';

type EntityRow = Prisma.EntityGetPayload<object>;
type RevisionRow = Prisma.EntityRevisionGetPayload<object>;

const toEntity = (r: EntityRow): EntityRecord => ({
  id: r.id, kind: r.kind as EntityRecord['kind'], label: r.label, headRevisionId: r.headRevisionId, publishedRevisionId: r.publishedRevisionId,
  version: r.version, createdBy: r.createdBy, createdAt: r.createdAt, updatedAt: r.updatedAt,
});
const toRevision = (r: RevisionRow): RevisionRecord => ({
  id: r.id, entityId: r.entityId, seq: r.seq, parentId: r.parentId, source: r.source, config: r.config as unknown as EntityConfig, hash: r.hash,
  authorWallet: r.authorWallet, jobId: r.jobId, message: r.message, createdAt: r.createdAt,
});

@Injectable()
export class EntityPrismaRepository extends EntityRepositoryPort {
  constructor(private readonly prisma: PrismaService) {
    super();
  }

  async list(tx?: TransactionHandle): Promise<EntityRecord[]> {
    return (await clientFor(this.prisma, tx).entity.findMany({ orderBy: { id: 'asc' } })).map(toEntity);
  }

  async find(id: string, tx?: TransactionHandle): Promise<EntityRecord | null> {
    const r = await clientFor(this.prisma, tx).entity.findUnique({ where: { id } });
    return r ? toEntity(r) : null;
  }

  async ensure(e: EntityRecord, tx: TransactionHandle): Promise<void> {
    await clientFor(this.prisma, tx).$executeRaw`
      INSERT INTO "asset"."Entity" ("id", "kind", "label", "headRevisionId", "publishedRevisionId", "version", "createdBy", "createdAt", "updatedAt")
      VALUES (${e.id}, ${e.kind}, ${e.label}, ${e.headRevisionId}, ${e.publishedRevisionId}, ${e.version}, ${e.createdBy}, ${e.createdAt}, ${e.updatedAt})
      ON CONFLICT ("id") DO NOTHING`;
  }

  async lock(id: string, tx: TransactionHandle): Promise<EntityRecord | null> {
    const rows = await clientFor(this.prisma, tx).$queryRaw<EntityRow[]>`SELECT * FROM "asset"."Entity" WHERE "id" = ${id} FOR UPDATE`;
    return rows[0] ? toEntity(rows[0]) : null;
  }

  async appendRevision(r: RevisionRecord, tx: TransactionHandle): Promise<void> {
    await clientFor(this.prisma, tx).entityRevision.create({
      data: { id: r.id, entityId: r.entityId, seq: r.seq, parentId: r.parentId, source: r.source, config: r.config as unknown as Prisma.InputJsonValue, hash: r.hash, authorWallet: r.authorWallet, jobId: r.jobId, message: r.message, createdAt: r.createdAt },
    });
  }

  async nextSeq(entityId: string, tx: TransactionHandle): Promise<number> {
    const agg = await clientFor(this.prisma, tx).entityRevision.aggregate({ where: { entityId }, _max: { seq: true } });
    return (agg._max.seq ?? 0) + 1;
  }

  async setPointers(id: string, p: { headRevisionId?: string; publishedRevisionId?: string }, at: Date, tx: TransactionHandle): Promise<void> {
    await clientFor(this.prisma, tx).entity.update({
      where: { id },
      data: { ...(p.headRevisionId ? { headRevisionId: p.headRevisionId } : {}), ...(p.publishedRevisionId ? { publishedRevisionId: p.publishedRevisionId, publishedAt: at } : {}), updatedAt: at, version: { increment: 1 } },
    });
  }

  async revision(id: string, tx?: TransactionHandle): Promise<RevisionRecord | null> {
    const r = await clientFor(this.prisma, tx).entityRevision.findUnique({ where: { id } });
    return r ? toRevision(r) : null;
  }

  async revisions(entityId: string): Promise<RevisionSummary[]> {
    const rows = await this.prisma.entityRevision.findMany({ where: { entityId }, orderBy: { seq: 'desc' }, omit: { source: true, config: true } });
    const jobIds = [...new Set(rows.map((r) => r.jobId).filter((j): j is string => j !== null))];
    const jobs = jobIds.length ? await this.prisma.editorJob.findMany({ where: { id: { in: jobIds } }, select: { id: true, prompt: true } }) : [];
    const prompt = new Map(jobs.map((j) => [j.id, j.prompt]));
    return rows.map((r) => ({ id: r.id, entityId: r.entityId, seq: r.seq, parentId: r.parentId, hash: r.hash, authorWallet: r.authorWallet, jobId: r.jobId, message: r.message, createdAt: r.createdAt, prompt: r.jobId ? prompt.get(r.jobId) ?? null : null }));
  }

  async seqs(ids: readonly string[]): Promise<Map<string, number>> {
    if (!ids.length) return new Map();
    const rows = await this.prisma.entityRevision.findMany({ where: { id: { in: [...ids] } }, select: { id: true, seq: true } });
    return new Map(rows.map((r) => [r.id, r.seq]));
  }

  async heads(): Promise<RevisionRecord[]> {
    return this.pointed('headRevisionId');
  }

  async published(): Promise<RevisionRecord[]> {
    return this.pointed('publishedRevisionId');
  }

  async publishedStamp(): Promise<string> {
    const agg = await this.prisma.entity.aggregate({ where: { publishedRevisionId: { not: null } }, _count: { _all: true }, _max: { publishedAt: true } });
    return `${agg._count._all}:${agg._max.publishedAt?.toISOString() ?? '-'}`;
  }

  private async pointed(column: 'headRevisionId' | 'publishedRevisionId'): Promise<RevisionRecord[]> {
    const rows = await this.prisma.entity.findMany({ where: { [column]: { not: null } }, select: { headRevisionId: true, publishedRevisionId: true } });
    const ids = rows.map((r) => r[column]).filter((v): v is string => !!v);
    if (!ids.length) return [];
    return (await this.prisma.entityRevision.findMany({ where: { id: { in: ids } } })).map(toRevision);
  }
}
