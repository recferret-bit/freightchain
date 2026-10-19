import { Injectable } from '@nestjs/common';
import { SettingsRepositoryPort } from '../../../application/ports/settings/settings.repository.port.js';
import type { TransactionHandle } from '../../../application/ports/shared/transaction.port.js';
import { clientFor } from '../prisma-client.js';
import { PrismaService } from '../prisma.service.js';

@Injectable()
export class SettingsPrismaRepository extends SettingsRepositoryPort {
  constructor(private readonly prisma: PrismaService) {
    super();
  }

  async all(tx?: TransactionHandle): Promise<readonly { key: string; value: number }[]> {
    const rows = await clientFor(this.prisma, tx).gameSetting.findMany();
    return rows.map((row) => ({ key: row.key, value: row.value }));
  }

  async upsert(key: string, value: number, tx?: TransactionHandle): Promise<void> {
    await clientFor(this.prisma, tx).gameSetting.upsert({ where: { key }, create: { key, value }, update: { value } });
  }
}
