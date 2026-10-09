import { Injectable } from '@nestjs/common';
import type { SignInRecord } from '../../../domain/auth/sign-in.js';
import { SignInRepositoryPort } from '../../../application/ports/auth/sign-in.repository.port.js';
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

  async deleteBefore(cutoff: Date): Promise<number> {
    const { count } = await this.prisma.signIn.deleteMany({ where: { at: { lt: cutoff } } });
    return count;
  }
}
