import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { EditorJobRepositoryPort } from '../../../application/ports/editor/editor-job.repository.port.js';
import type { EditorJobRecord, JobEventRecord, JobEventType, JobStatus } from '../../../domain/editor/editor-job.js';
import type { TransactionHandle } from '../../../application/ports/shared/transaction.port.js';
import { clientFor } from '../prisma-client.js';
import { PrismaService } from '../prisma.service.js';

type Row = Prisma.EditorJobGetPayload<object>;
const toJob = (r: Row): EditorJobRecord => ({ ...r, status: r.status as JobStatus });

@Injectable()
export class EditorJobPrismaRepository extends EditorJobRepositoryPort {
  constructor(private readonly prisma: PrismaService) {
    super();
  }

  async insert(j: EditorJobRecord): Promise<void> {
    await this.prisma.editorJob.create({ data: j });
  }

  async find(id: string): Promise<EditorJobRecord | null> {
    const r = await this.prisma.editorJob.findUnique({ where: { id } });
    return r ? toJob(r) : null;
  }

  async list({ wallet, entityId, limit }: { wallet?: string; entityId?: string; limit: number }): Promise<EditorJobRecord[]> {
    return (await this.prisma.editorJob.findMany({ where: { ...(wallet ? { wallet } : {}), ...(entityId ? { entityId } : {}) }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: limit })).map(toJob);
  }

  async update(id: string, patch: Partial<EditorJobRecord>, from?: readonly JobStatus[], tx?: TransactionHandle): Promise<boolean> {
    const r = await clientFor(this.prisma, tx).editorJob.updateMany({ where: { id, ...(from ? { status: { in: [...from] } } : {}) }, data: patch });
    return r.count > 0;
  }

  async addUsage(id: string, tokensIn: number, tokensOut: number): Promise<void> {
    await this.prisma.editorJob.update({ where: { id }, data: { tokensIn: { increment: tokensIn }, tokensOut: { increment: tokensOut } } });
  }

  async lock(id: string, tx: TransactionHandle): Promise<void> {
    await clientFor(this.prisma, tx).$queryRaw`SELECT "id" FROM "asset"."EditorJob" WHERE "id" = ${id}::uuid FOR UPDATE`;
  }

  /** the next seq under the job row's lock: the runner and the MCP callbacks append to one job at the same time */
  async appendEvent(jobId: string, type: JobEventType, payload: Record<string, unknown>, at: Date, tx?: TransactionHandle): Promise<JobEventRecord> {
    const write = async (db: ReturnType<typeof clientFor>): Promise<JobEventRecord> => {
      await db.$queryRaw`SELECT "id" FROM "asset"."EditorJob" WHERE "id" = ${jobId}::uuid FOR UPDATE`;
      const max = await db.editorJobEvent.aggregate({ where: { jobId }, _max: { seq: true } });
      const seq = (max._max.seq ?? 0) + 1;
      await db.editorJobEvent.create({ data: { jobId, seq, type, payload: payload as Prisma.InputJsonValue, at } });
      return { jobId, seq, type, payload, at };
    };
    return tx ? write(clientFor(this.prisma, tx)) : this.prisma.$transaction((db) => write(db));
  }

  async createdIds(jobId: string, tx?: TransactionHandle): Promise<string[]> {
    const rows = await clientFor(this.prisma, tx).$queryRaw<{ id: string }[]>`
      SELECT DISTINCT payload->>'entityId' AS id FROM "asset"."EditorJobEvent"
      WHERE "jobId" = ${jobId}::uuid AND "type" = 'draft' AND payload->>'entityId' IS NOT NULL`;
    return rows.map((r) => r.id).filter((id) => id.length > 0);
  }

  async events(jobId: string, after: number, limit: number): Promise<JobEventRecord[]> {
    const rows = await this.prisma.editorJobEvent.findMany({ where: { jobId, seq: { gt: after } }, orderBy: { seq: 'asc' }, take: limit });
    return rows.map((r) => ({ jobId: r.jobId, seq: r.seq, type: r.type as JobEventType, payload: r.payload as Record<string, unknown>, at: r.at }));
  }

  async countSince(wallet: string, since: Date): Promise<number> {
    return this.prisma.editorJob.count({ where: { wallet, createdAt: { gte: since } } });
  }

  async open(): Promise<EditorJobRecord[]> {
    return (await this.prisma.editorJob.findMany({ where: { status: { in: ['queued', 'running'] } }, orderBy: { createdAt: 'asc' } })).map(toJob);
  }
}
