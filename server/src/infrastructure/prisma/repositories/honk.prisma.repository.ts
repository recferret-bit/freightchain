import { Injectable } from '@nestjs/common';
import { HonkRepositoryPort, type HonkAccountRow, type HonkBurnRow, type HonkMintRow, type HonkVisualRow } from '../../../application/ports/honk/honk.repository.port.js';
import type { HonkPartSeed } from '../../../domain/honk/parts-catalog.js';
import type { TransactionHandle } from '../../../application/ports/shared/transaction.port.js';
import { clientFor, isUniqueViolation } from '../prisma-client.js';
import { PrismaService } from '../prisma.service.js';

const EMPTY: Omit<HonkAccountRow, 'wallet'> = { balance: 0n, minted: 0n, burned: 0n };

@Injectable()
export class HonkPrismaRepository extends HonkRepositoryPort {
  constructor(private readonly prisma: PrismaService) { super(); }

  async findMint(rideId: string, tx?: TransactionHandle): Promise<HonkMintRow | null> {
    const row = await clientFor(this.prisma, tx).honkMint.findUnique({ where: { rideId } });
    return row ? { ...row, tier: row.tier } : null;
  }

  async lockEmission(tx?: TransactionHandle): Promise<bigint> {
    const db = clientFor(this.prisma, tx);
    // ON CONFLICT, not Prisma upsert: two first mints both inserting id 1 abort the loser transaction (P2002).
    await db.$executeRaw`INSERT INTO "economy"."HonkSupply" ("id", "minted") VALUES (1, 0) ON CONFLICT ("id") DO NOTHING`;
    const rows = await db.$queryRaw<{ minted: bigint }[]>`SELECT minted FROM "economy"."HonkSupply" WHERE id = 1 FOR UPDATE`;
    return rows[0]?.minted ?? 0n;
  }

  async addEmission(amount: bigint, tx?: TransactionHandle): Promise<void> {
    await clientFor(this.prisma, tx).honkSupply.update({ where: { id: 1 }, data: { minted: { increment: amount } } });
  }

  async subEmission(amount: bigint, tx?: TransactionHandle): Promise<void> {
    await clientFor(this.prisma, tx).honkSupply.update({ where: { id: 1 }, data: { minted: { decrement: amount } } });
  }

  async emittedOnDay(start: Date, wallet: string | null, tx?: TransactionHandle): Promise<bigint> {
    const end = new Date(start.getTime() + 86_400_000);
    const row = await clientFor(this.prisma, tx).honkMint.aggregate({
      where: { createdAt: { gte: start, lt: end }, ...(wallet ? { wallet } : {}) },
      _sum: { amount: true },
    });
    return row._sum.amount ?? 0n;
  }

  async insertMint(row: HonkMintRow, tx?: TransactionHandle): Promise<boolean> {
    // ON CONFLICT keeps the transaction open so the loser can read the winner's row. A thrown unique violation would abort it.
    const inserted = await clientFor(this.prisma, tx).$queryRaw<{ rideId: string }[]>`
      INSERT INTO "economy"."HonkMint" ("rideId", "wallet", "tier", "amount", "band20", "band50", "band100", "createdAt", "releaseAt", "released")
      VALUES (${row.rideId}, ${row.wallet}, ${row.tier}, ${row.amount}, ${row.band20}, ${row.band50}, ${row.band100}, ${row.createdAt}, ${row.releaseAt}, ${row.released})
      ON CONFLICT ("rideId") DO NOTHING
      RETURNING "rideId"`;
    return inserted.length === 1;
  }

  async markReleased(rideId: string, tx?: TransactionHandle): Promise<boolean> {
    const { count } = await clientFor(this.prisma, tx).honkMint.updateMany({ where: { rideId, released: false }, data: { released: true } });
    return count === 1;
  }

  async deleteMint(rideId: string, tx?: TransactionHandle): Promise<boolean> {
    const { count } = await clientFor(this.prisma, tx).honkMint.deleteMany({ where: { rideId, released: false } });
    return count === 1;
  }

  async listDue(now: Date, limit: number): Promise<HonkMintRow[]> {
    const rows = await this.prisma.honkMint.findMany({ where: { released: false, releaseAt: { lte: now } }, orderBy: { releaseAt: 'asc' }, take: limit });
    return rows.map((row) => ({ ...row, tier: row.tier }));
  }

  async balance(wallet: string, tx?: TransactionHandle): Promise<bigint> {
    return (await this.account(wallet, tx)).balance;
  }

  async account(wallet: string, tx?: TransactionHandle): Promise<HonkAccountRow> {
    const row = await clientFor(this.prisma, tx).honkAccount.findUnique({ where: { wallet } });
    return row ? { wallet, balance: row.balance, minted: row.minted, burned: row.burned } : { wallet, ...EMPTY };
  }

  async debit(wallet: string, amount: bigint, at: Date, tx?: TransactionHandle): Promise<boolean> {
    const { count } = await clientFor(this.prisma, tx).honkAccount.updateMany({ where: { wallet, balance: { gte: amount } }, data: { balance: { decrement: amount }, burned: { increment: amount }, updatedAt: at } });
    return count === 1;
  }

  async credit(wallet: string, amount: bigint, at: Date, tx?: TransactionHandle): Promise<void> {
    await clientFor(this.prisma, tx).honkAccount.upsert({
      where: { wallet },
      create: { wallet, balance: amount, minted: amount, burned: 0n, updatedAt: at },
      update: { balance: { increment: amount }, minted: { increment: amount }, updatedAt: at },
    });
  }

  async insertBurn(row: HonkBurnRow, tx?: TransactionHandle): Promise<void> {
    await clientFor(this.prisma, tx).honkBurn.create({ data: row });
  }

  async reverseBurn(id: string, tx?: TransactionHandle): Promise<void> {
    const db = clientFor(this.prisma, tx);
    const row = await db.honkBurn.findUnique({ where: { id } });
    if (!row) return;
    await db.honkAccount.update({ where: { wallet: row.wallet }, data: { balance: { increment: row.amount }, burned: { decrement: row.amount } } });
    await db.honkBurn.delete({ where: { id } });
  }

  async lastStreamBurn(wallet: string, rideId: string, tx?: TransactionHandle): Promise<Date | null> {
    const row = await clientFor(this.prisma, tx).honkBurn.findFirst({ where: { wallet, kind: 'stream', ref: rideId }, orderBy: { createdAt: 'desc' } });
    return row?.createdAt ?? null;
  }

  async counts(wallet: string): Promise<{ mints: number; finishes: number }> {
    const rows = await this.prisma.honkMint.findMany({ where: { wallet, released: true, amount: { gt: 0 } }, select: { band100: true } });
    return { mints: rows.length, finishes: rows.filter((r) => r.band100).length };
  }

  async visuals(wallet: string, tx?: TransactionHandle): Promise<HonkVisualRow[]> {
    return clientFor(this.prisma, tx).honkVisual.findMany({ where: { wallet }, orderBy: { createdAt: 'asc' } });
  }

  async insertVisual(row: HonkVisualRow, tx?: TransactionHandle): Promise<boolean> {
    try {
      await clientFor(this.prisma, tx).honkVisual.create({ data: row });
      return true;
    } catch (error) {
      if (isUniqueViolation(error)) return false;
      throw error;
    }
  }

  async listParts(): Promise<HonkPartSeed[]> {
    const rows = await this.prisma.honkPart.findMany({ orderBy: { sort: 'asc' } });
    return rows.map(toPart);
  }

  async findPart(slot: string, item: string, tx?: TransactionHandle): Promise<HonkPartSeed | null> {
    const row = await clientFor(this.prisma, tx).honkPart.findUnique({ where: { slot_item: { slot, item } } });
    return row ? toPart(row) : null;
  }

  async setVisualChain(id: string, mint: string, signature: string | null, tx?: TransactionHandle): Promise<void> {
    await clientFor(this.prisma, tx).honkVisual.update({ where: { id }, data: { chainMint: mint, chainSignature: signature } });
  }

  async deleteVisual(id: string, tx?: TransactionHandle): Promise<void> {
    await clientFor(this.prisma, tx).honkVisual.deleteMany({ where: { id } });
  }
}

function toPart(row: { slot: string; item: string; name: string; description: string; price: bigint | null; sort: number }): HonkPartSeed {
  return { slot: row.slot as HonkPartSeed['slot'], item: row.item, name: row.name, description: row.description, price: row.price, sort: row.sort };
}
