import { Injectable } from '@nestjs/common';
import type { SignInRecord } from '../../../domain/auth/sign-in.js';
import { SignInRepositoryPort, type SignInSummary } from '../../../application/ports/auth/sign-in.repository.port.js';
import { PrismaService } from '../prisma.service.js';

@Injectable()
export class SignInPrismaRepository extends SignInRepositoryPort {
  constructor(private readonly prisma: PrismaService) {
    super();
  }

  async insert(record: SignInRecord): Promise<void> {
    await this.prisma.signIn.create({ data: { wallet: record.wallet, at: record.at, ip: record.ip, userAgent: record.userAgent } });
  }

  async recent(limit: number, wallet?: string): Promise<SignInRecord[]> {
    const rows = await this.prisma.signIn.findMany({ where: wallet ? { wallet } : {}, orderBy: [{ at: 'desc' }, { id: 'desc' }], take: limit });
    return rows.map((r) => ({ wallet: r.wallet, at: r.at, ip: r.ip, userAgent: r.userAgent }));
  }

  countSince(at: Date): Promise<number> {
    return this.prisma.signIn.count({ where: { at: { gte: at } } });
  }

  async summaryOf(wallets: readonly string[]): Promise<SignInSummary[]> {
    if (!wallets.length) return [];
    const [first, ips] = await Promise.all([
      this.prisma.signIn.groupBy({ by: ['wallet'], where: { wallet: { in: [...wallets] } }, _min: { at: true } }),
      this.prisma.signIn.findMany({ where: { wallet: { in: [...wallets] }, ip: { not: null } }, distinct: ['wallet', 'ip'], select: { wallet: true, ip: true }, orderBy: [{ wallet: 'asc' }, { ip: 'asc' }] }),
    ]);
    return first.flatMap((g) => (g._min.at ? [{ wallet: g.wallet, firstAt: g._min.at, ips: ips.filter((r) => r.wallet === g.wallet).map((r) => r.ip as string) }] : []))
      .sort((a, b) => (a.wallet < b.wallet ? -1 : a.wallet > b.wallet ? 1 : 0));
  }

  async deleteBefore(cutoff: Date): Promise<number> {
    const { count } = await this.prisma.signIn.deleteMany({ where: { at: { lt: cutoff } } });
    return count;
  }
}
