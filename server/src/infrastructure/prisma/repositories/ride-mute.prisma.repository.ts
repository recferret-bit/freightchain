import { Injectable } from '@nestjs/common';
import { RideMuteRepositoryPort } from '../../../application/ports/live/ride-mute.repository.port.js';
import type { TransactionHandle } from '../../../application/ports/shared/transaction.port.js';
import { clientFor } from '../prisma-client.js';
import { PrismaService } from '../prisma.service.js';

@Injectable()
export class RideMutePrismaRepository extends RideMuteRepositoryPort {
  constructor(private readonly prisma: PrismaService) {
    super();
  }

  /** ONE statement either way: createMany skipDuplicates / deleteMany – two racing mutes of the same wallet leave one row */
  async set(rideId: string, wallet: string, muted: boolean, now: Date, tx?: TransactionHandle): Promise<boolean> {
    const db = clientFor(this.prisma, tx);
    const { count } = muted
      ? await db.rideMute.createMany({ data: [{ rideId, wallet, mutedAt: now }], skipDuplicates: true })
      : await db.rideMute.deleteMany({ where: { rideId, wallet } });
    return count === 1;
  }

  async isMuted(rideId: string, wallet: string): Promise<boolean> {
    return (await this.prisma.rideMute.count({ where: { rideId, wallet } })) > 0;
  }

  async list(rideId: string): Promise<Set<string>> {
    return new Set((await this.prisma.rideMute.findMany({ where: { rideId }, select: { wallet: true } })).map((m) => m.wallet));
  }
}
