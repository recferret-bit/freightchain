import { Injectable } from '@nestjs/common';
import { CosmeticRepositoryPort, type CosmeticUnlockRecord } from '../../../application/ports/players/cosmetic.repository.port.js';
import type { TransactionHandle } from '../../../application/ports/shared/transaction.port.js';
import { isCosmeticItem, isCosmeticSlot, type CosmeticSlot } from '../../../domain/economy/cosmetics.js';
import { clientFor } from '../prisma-client.js';
import { PrismaService } from '../prisma.service.js';

@Injectable()
export class CosmeticPrismaRepository extends CosmeticRepositoryPort {
  constructor(private readonly prisma: PrismaService) {
    super();
  }

  async unlock(r: CosmeticUnlockRecord, tx?: TransactionHandle): Promise<boolean> {
    const { count } = await clientFor(this.prisma, tx).cosmeticUnlock.createMany({ data: [r], skipDuplicates: true });
    return count === 1;
  }

  async has(wallet: string, slot: CosmeticSlot, item: string, tx?: TransactionHandle): Promise<boolean> {
    return (await clientFor(this.prisma, tx).cosmeticUnlock.count({ where: { wallet, slot, item } })) === 1;
  }

  async listUnlocked(wallet: string, tx?: TransactionHandle): Promise<CosmeticUnlockRecord[]> {
    const rows = await clientFor(this.prisma, tx).cosmeticUnlock.findMany({ where: { wallet }, orderBy: [{ at: 'asc' }, { slot: 'asc' }, { item: 'asc' }] });
    return rows.flatMap((r) => (isCosmeticSlot(r.slot) ? [{ ...r, slot: r.slot }] : []));
  }

  async equip(wallet: string, slot: CosmeticSlot, item: string, tx?: TransactionHandle): Promise<void> {
    await clientFor(this.prisma, tx).cosmeticEquip.upsert({ where: { wallet_slot: { wallet, slot } }, create: { wallet, slot, item }, update: { item } });
  }

  async listEquipped(wallet: string, tx?: TransactionHandle): Promise<Partial<Record<CosmeticSlot, string>>> {
    const rows = await clientFor(this.prisma, tx).cosmeticEquip.findMany({ where: { wallet } });
    return Object.fromEntries(rows.filter((r) => isCosmeticSlot(r.slot) && isCosmeticItem(r.slot, r.item)).map((r) => [r.slot, r.item]));
  }
}
