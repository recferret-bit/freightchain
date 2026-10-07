import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { ServiceUnavailableError, VersionConflictError } from '../../domain/shared/errors.js';
import { TransactionPort, type TransactionHandle } from '../../application/ports/shared/transaction.port.js';
import { PrismaService } from './prisma.service.js';

const TX_TIMEOUT_MS = 10_000;
/** how long to wait for a pooled connection before giving up (Prisma's default is 2 s – too short when requests queue on a wallet's row lock on a small host) */
const TX_MAX_WAIT_MS = 8_000;

@Injectable()
export class TransactionPrismaAdapter extends TransactionPort {
  constructor(private readonly prisma: PrismaService) {
    super();
  }

  /** Infrastructure failures that are worth a retry become retryable domain errors (503 / 409) instead of a 500. */
  async run<T>(fn: (tx: TransactionHandle) => Promise<T>): Promise<T> {
    try {
      return await this.prisma.$transaction((client) => fn(client as unknown as TransactionHandle), { timeout: TX_TIMEOUT_MS, maxWait: TX_MAX_WAIT_MS });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError) {
        if (error.code === 'P2028') throw new ServiceUnavailableError('the server is busy – try again'); // no connection in time / transaction expired
        if (error.code === 'P2034') throw new VersionConflictError('a concurrent request got in first – try again'); // write conflict or deadlock
      }
      throw error;
    }
  }
}
