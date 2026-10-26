import { Injectable } from '@nestjs/common';
import { Prisma, type ConvoyInvite, type ConvoyLedger } from '@prisma/client';
import { ConvoyRepositoryPort, type ConvoyRow, type ConvoyLedgerRow, type ConvoyRideRow, type HiddenRead, type ReferrerCounts } from '../../../application/referral/convoy.repository.port.js';
import type { TransactionHandle } from '../../../application/ports/shared/transaction.port.js';
import { clientFor } from '../prisma-client.js';
import { PrismaService } from '../prisma.service.js';

const invite = (row: ConvoyInvite): ConvoyRow => ({ ...row, status: row.status as ConvoyRow['status'], policy: row.policy as ConvoyRow['policy'] });
const ledger = (row: ConvoyLedger): ConvoyLedgerRow => ({ ...row, kind: row.kind as ConvoyLedgerRow['kind'], unit: row.unit as ConvoyLedgerRow['unit'], chainState: row.chainState as ConvoyLedgerRow['chainState'] });

@Injectable()
export class ConvoyPrismaRepository extends ConvoyRepositoryPort {
  constructor(private readonly prisma: PrismaService) { super(); }

  privacyColumn(): 'present' { return 'present'; }

  async lockPromoBudget(tx: TransactionHandle): Promise<void> {
    // Player locks precede this shared cap lock. It is held until the credit transaction commits.
    await clientFor(this.prisma, tx).$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(72144, 1)`;
  }

  async getByReferee(referee: string, tx?: TransactionHandle): Promise<ConvoyRow | null> {
    const row = await clientFor(this.prisma, tx).convoyInvite.findUnique({ where: { referee } });
    return row ? invite(row) : null;
  }

  async listByReferrer(referrer: string, tx?: TransactionHandle): Promise<ConvoyRow[]> {
    return (await clientFor(this.prisma, tx).convoyInvite.findMany({ where: { referrer }, orderBy: { referee: 'asc' } })).map(invite);
  }

  async insert(row: ConvoyRow, tx?: TransactionHandle): Promise<boolean> {
    return (await clientFor(this.prisma, tx).convoyInvite.createMany({ data: [{ ...row, policy: row.policy ?? Prisma.DbNull }], skipDuplicates: true })).count === 1;
  }

  async save(row: ConvoyRow, tx?: TransactionHandle): Promise<void> {
    await clientFor(this.prisma, tx).convoyInvite.update({ where: { referee: row.referee }, data: { ...row, policy: row.policy ?? Prisma.DbNull } });
  }

  async deleteReferee(referee: string, tx?: TransactionHandle): Promise<boolean> {
    return (await clientFor(this.prisma, tx).convoyInvite.deleteMany({ where: { referee } })).count === 1;
  }

  async listPendingExpired(now: Date, tx?: TransactionHandle): Promise<ConvoyRow[]> {
    return (await clientFor(this.prisma, tx).convoyInvite.findMany({ where: { status: 'pending', expiresAt: { lt: now } } })).map(invite);
  }

  async listActivePast(now: Date, tx?: TransactionHandle): Promise<ConvoyRow[]> {
    return (await clientFor(this.prisma, tx).convoyInvite.findMany({ where: { status: 'active', m1At: null, qualifyExpiresAt: { lt: now } } })).map(invite);
  }

  async insertLedger(row: ConvoyLedgerRow, tx?: TransactionHandle): Promise<boolean> {
    return (await clientFor(this.prisma, tx).convoyLedger.createMany({ data: [row], skipDuplicates: true })).count === 1;
  }

  override async releaseLedger(id: string, at: Date, tx?: TransactionHandle): Promise<boolean> {
    return (await clientFor(this.prisma, tx).convoyLedger.updateMany({ where: { id, unit: 'ten4', releasedAt: null }, data: { releasedAt: at } })).count === 1;
  }

  async pendingSettlements(now: Date, heldBefore: Date, limit: number): Promise<ConvoyLedgerRow[]> {
    return (await this.prisma.convoyLedger.findMany({ where: { chainState: 'held', at: { lte: heldBefore }, OR: [{ chainRetryAt: null }, { chainRetryAt: { lte: now } }] }, orderBy: [{ at: 'asc' }, { id: 'asc' }], take: limit })).map(ledger);
  }

  async findLedger(id: string, tx?: TransactionHandle): Promise<ConvoyLedgerRow | null> {
    const row = await clientFor(this.prisma, tx).convoyLedger.findUnique({ where: { id } });
    return row ? ledger(row) : null;
  }

  async saveSettlement(row: ConvoyLedgerRow, expectedLease: string | null, tx: TransactionHandle): Promise<boolean> {
    const { chainState, paidUnits, chainLeaseId, chainRetryAt, chainSignature, chainLastValidBlockHeight, chainResolvedAt, capReason, releasedAt } = row;
    return (await clientFor(this.prisma, tx).convoyLedger.updateMany({ where: { id: row.id, chainState: 'held', chainLeaseId: expectedLease }, data: { chainState, paidUnits, chainLeaseId, chainRetryAt, chainSignature, chainLastValidBlockHeight, chainResolvedAt, capReason, releasedAt } })).count === 1;
  }

  async ledger(tx?: TransactionHandle): Promise<ConvoyLedgerRow[]> {
    return (await clientFor(this.prisma, tx).convoyLedger.findMany({ orderBy: [{ at: 'asc' }, { id: 'asc' }] })).map(ledger);
  }

  async recordRide(row: ConvoyRideRow, tx?: TransactionHandle): Promise<void> {
    await clientFor(this.prisma, tx).convoyRide.createMany({ data: [row], skipDuplicates: true });
  }

  async ridesOf(wallet: string, tx?: TransactionHandle): Promise<ConvoyRideRow[]> {
    return clientFor(this.prisma, tx).convoyRide.findMany({ where: { wallet }, orderBy: [{ at: 'asc' }, { rideId: 'asc' }] });
  }

  async referrerCounts(tx?: TransactionHandle): Promise<ReferrerCounts[]> {
    const rows = await clientFor(this.prisma, tx).convoyInvite.groupBy({ by: ['referrer', 'status'], where: { status: { in: ['active', 'qualified'] } }, _count: { _all: true, m1At: true, m2At: true }, _min: { m1At: true } });
    const counts = new Map<string, ReferrerCounts>();
    for (const row of rows) {
      const count = counts.get(row.referrer) ?? { referrer: row.referrer, active: 0, qualified: 0, milestones: 0, firstMilestone: null };
      if (row.status === 'active') count.active += row._count._all;
      else count.qualified += row._count._all;
      count.milestones += row._count.m1At + row._count.m2At;
      if (row._min.m1At && (!count.firstMilestone || row._min.m1At < count.firstMilestone)) count.firstMilestone = row._min.m1At;
      counts.set(row.referrer, count);
    }
    return [...counts.values()];
  }

  async recentActiveCount(referrer: string, since: Date, until: Date, tx?: TransactionHandle): Promise<number> {
    const db = clientFor(this.prisma, tx);
    const friends = await db.convoyInvite.findMany({ where: { referrer, status: { in: ['active', 'qualified'] } }, select: { referee: true } });
    if (!friends.length) return 0;
    return (await db.convoyRide.groupBy({ by: ['wallet'], where: { wallet: { in: friends.map((row) => row.referee) }, counted: true, at: { gte: since, lte: until } } })).length;
  }

  async readHidden(wallet: string, tx?: TransactionHandle): Promise<HiddenRead> {
    const player = await clientFor(this.prisma, tx).player.findUnique({ where: { wallet }, select: { convoyHidden: true } });
    return { columnPresent: true, hidden: player?.convoyHidden === true };
  }

  async writeHidden(wallet: string, hidden: boolean, tx?: TransactionHandle): Promise<HiddenRead> {
    const player = await clientFor(this.prisma, tx).player.update({ where: { wallet }, data: { convoyHidden: hidden }, select: { convoyHidden: true } });
    return { columnPresent: true, hidden: player.convoyHidden };
  }
}
