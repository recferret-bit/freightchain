import { Prisma } from '@prisma/client';
import type { TransactionHandle } from '../../application/ports/shared/transaction.port.js';
import type { PrismaService } from './prisma.service.js';

export type DbClient = PrismaService | Prisma.TransactionClient;

/** The client a repository call should use: the transaction's when one is passed, else the shared connection. */
export const clientFor = (prisma: PrismaService, tx?: TransactionHandle): DbClient => (tx ? (tx as unknown as Prisma.TransactionClient) : prisma);

/** P2002 – a unique constraint was violated. */
export const isUniqueViolation = (error: unknown): boolean => error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
