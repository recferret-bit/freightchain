import { Injectable } from '@nestjs/common';
import { TermsAcceptanceRepositoryPort, type TermsAcceptanceRecord } from '../../../application/ports/players/terms-acceptance.repository.port.js';
import type { TransactionHandle } from '../../../application/ports/shared/transaction.port.js';
import { clientFor } from '../prisma-client.js';
import { PrismaService } from '../prisma.service.js';
@Injectable()
export class TermsAcceptancePrismaRepository extends TermsAcceptanceRepositoryPort {
  constructor(private readonly prisma: PrismaService) { super(); }
  async insert(record: TermsAcceptanceRecord, tx: TransactionHandle): Promise<void> {
    await clientFor(this.prisma, tx).termsAcceptance.createMany({ data: [record], skipDuplicates: true });
  }
}
