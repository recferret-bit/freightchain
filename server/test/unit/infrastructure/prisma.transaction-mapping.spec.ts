import { Prisma } from '@prisma/client';
import { TransactionPrismaAdapter } from '../../../src/infrastructure/prisma/transaction.prisma.adapter.js';
import type { PrismaService } from '../../../src/infrastructure/prisma/prisma.service.js';
import { ServiceUnavailableError, VersionConflictError } from '../../../src/domain/shared/errors.js';

/** Commit / rollback are proven on PostgreSQL (transaction.prisma.adapter.integration.spec.ts); this pins the error mapping and the wait budget. */
const prismaFailingWith = (code: string, seen: { options?: unknown } = {}) => ({
  $transaction: async (_fn: unknown, options: unknown) => { seen.options = options; throw new Prisma.PrismaClientKnownRequestError('x', { code, clientVersion: '6' }); },
}) as unknown as PrismaService;

describe('TransactionPrismaAdapter – error mapping', () => {
  it('no connection in time (P2028) → 503, retryable; a write conflict / deadlock (P2034) → 409, retryable', async () => {
    await expect(new TransactionPrismaAdapter(prismaFailingWith('P2028')).run(async () => 1)).rejects.toBeInstanceOf(ServiceUnavailableError);
    await expect(new TransactionPrismaAdapter(prismaFailingWith('P2034')).run(async () => 1)).rejects.toBeInstanceOf(VersionConflictError);
  });
  it('anything else passes through untouched', async () => {
    await expect(new TransactionPrismaAdapter(prismaFailingWith('P2002')).run(async () => 1)).rejects.toBeInstanceOf(Prisma.PrismaClientKnownRequestError);
  });
  it('waits up to 8 s for a pooled connection (Prisma defaults to 2 s)', async () => {
    const seen: { options?: unknown } = {};
    await new TransactionPrismaAdapter(prismaFailingWith('P2028', seen)).run(async () => 1).catch(() => undefined);
    expect(seen.options).toEqual({ timeout: 10_000, maxWait: 8_000 });
  });
});
