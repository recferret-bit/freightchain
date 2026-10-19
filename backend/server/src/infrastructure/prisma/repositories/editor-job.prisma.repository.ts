import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { EditorJobRepositoryPort } from '../../../application/ports/editor/editor-job.repository.port.js';
import type { EditorJobRecord, EditorMcpCallInput, EditorMcpCallRecord, JobEventRecord, JobEventType, JobStatus } from '../../../domain/editor/editor-job.js';
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

  async admit(job: EditorJobRecord, since: Date, dailyCap: number): Promise<'accepted' | 'job_cap' | 'job_running'> {
    return this.prisma.$transaction(async (db) => {
      await this.queueLock(db);
      if (await db.editorJob.count({ where: { wallet: job.wallet, createdAt: { gte: since } } }) >= dailyCap) return 'job_cap';
      const busy = await db.editorJob.count({ where: { status: { in: ['queued', 'running'] }, OR: [{ wallet: job.wallet }, ...(job.entityId ? [{ entityId: job.entityId }] : [])] } });
      if (busy) return 'job_running';
      await db.editorJob.create({ data: job });
      await db.editorJobEvent.create({ data: { jobId: job.id, seq: 1, type: 'status', payload: { status: 'queued', provider: job.provider, model: job.model }, at: job.createdAt } });
      return 'accepted';
    });
  }

  async claim(parallel: number, now: Date, timeoutMs: number): Promise<EditorJobRecord | null> {
    if (parallel <= 0) return null;
    return this.prisma.$transaction(async (db) => {
      await this.queueLock(db);
      if (await db.editorJob.count({ where: { status: 'running' } }) >= parallel) return null;
      const row = await db.editorJob.findFirst({ where: { status: 'queued', createdAt: { gt: new Date(now.getTime() - timeoutMs) } }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] });
      if (!row) return null;
      const moved = await db.editorJob.updateMany({ where: { id: row.id, status: 'queued' }, data: { status: 'running', startedAt: now } });
      if (!moved.count) return null; // cancellation won the row lock
      await this.eventIn(db, row.id, 'status', { status: 'running', provider: row.provider, model: row.model }, now);
      return toJob({ ...row, status: 'running', startedAt: now });
    });
  }

  async conclude(id: string, status: 'done' | 'failed' | 'cancelled', error: string | null, at: Date): Promise<boolean> {
    return this.prisma.$transaction((db) => this.concludeIn(db, id, status, error, at));
  }

  async expire(now: Date, timeoutMs: number): Promise<number> {
    return this.prisma.$transaction(async (db) => {
      await this.queueLock(db);
      const before = new Date(now.getTime() - timeoutMs);
      const rows = await db.editorJob.findMany({ where: { OR: [
        { status: 'queued', createdAt: { lte: before } },
        { status: 'running', OR: [{ startedAt: { lte: before } }, { startedAt: null }] },
      ] }, take: 100 });
      let failed = 0;
      for (const row of rows) {
        const why = row.status === 'queued' ? 'the job waited longer than the timeout (the AI editor is paused or busy)' : 'the server restarted or the job timed out';
        if (await this.concludeIn(db, row.id, 'failed', why, now)) failed++;
      }
      return failed;
    });
  }

  /** Short DB-only critical sections serialize admission and the global execution budget across replicas. */
  private async queueLock(db: Prisma.TransactionClient): Promise<void> {
    await db.$executeRaw`SELECT pg_advisory_xact_lock(834351, 1)`;
  }

  private async concludeIn(db: Prisma.TransactionClient, id: string, status: 'done' | 'failed' | 'cancelled', error: string | null, at: Date): Promise<boolean> {
    const moved = await db.editorJob.updateMany({ where: { id, status: { in: ['queued', 'running'] } }, data: { status, error, finishedAt: at } });
    if (!moved.count) return false;
    await this.eventIn(db, id, 'status', { status }, at);
    await this.eventIn(db, id, status === 'done' ? 'done' : 'error', status === 'done' ? { status } : { status, message: error ?? status }, at);
    return true;
  }

  /** Caller holds the job row lock. */
  private async eventIn(db: Prisma.TransactionClient, jobId: string, type: JobEventType, payload: Record<string, unknown>, at: Date): Promise<void> {
    const max = await db.editorJobEvent.aggregate({ where: { jobId }, _max: { seq: true } });
    await db.editorJobEvent.create({ data: { jobId, seq: (max._max.seq ?? 0) + 1, type, payload: payload as Prisma.InputJsonValue, at } });
  }

  async insert(j: EditorJobRecord): Promise<void> {
    await this.prisma.editorJob.create({ data: j });
  }

  async find(id: string, tx?: TransactionHandle): Promise<EditorJobRecord | null> {
    const r = await clientFor(this.prisma, tx).editorJob.findUnique({ where: { id } });
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

  async recordMcpCall(call: EditorMcpCallInput): Promise<EditorMcpCallRecord> {
    return this.prisma.$transaction(async (db) => {
      await db.$queryRaw`SELECT "id" FROM "asset"."EditorJob" WHERE "id" = ${call.jobId}::uuid FOR UPDATE`;
      const max = await db.editorMcpCall.aggregate({ where: { jobId: call.jobId }, _max: { seq: true } });
      const seq = (max._max.seq ?? 0) + 1;
      const id = randomUUID();
      await db.editorMcpCall.create({ data: { id, jobId: call.jobId, wallet: call.wallet, seq, tool: call.tool, args: call.args as Prisma.InputJsonValue, result: call.result, ok: call.ok, createdAt: call.createdAt } });
      return { ...call, id, seq };
    });
  }

  async mcpCalls(jobId: string): Promise<EditorMcpCallRecord[]> {
    const rows = await this.prisma.editorMcpCall.findMany({ where: { jobId }, orderBy: { seq: 'asc' } });
    return rows.map((r) => ({ id: r.id, jobId: r.jobId, wallet: r.wallet, seq: r.seq, tool: r.tool, args: r.args as Record<string, unknown>, result: r.result, ok: r.ok, createdAt: r.createdAt }));
  }

  async countSince(wallet: string, since: Date): Promise<number> {
    return this.prisma.editorJob.count({ where: { wallet, createdAt: { gte: since } } });
  }

  async open(): Promise<EditorJobRecord[]> {
    return (await this.prisma.editorJob.findMany({ where: { status: { in: ['queued', 'running'] } }, orderBy: { createdAt: 'asc' } })).map(toJob);
  }
}
