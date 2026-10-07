import { Injectable } from '@nestjs/common';
import { AuthChallenge } from '../../../domain/auth/auth-challenge.entity.js';
import { ChallengeRepositoryPort } from '../../../application/ports/auth/challenge.repository.port.js';
import { PrismaService } from '../prisma.service.js';

interface ChallengeRow {
  wallet: string;
  message: string;
  expiresAt: Date;
}

@Injectable()
export class ChallengePrismaRepository extends ChallengeRepositoryPort {
  constructor(private readonly prisma: PrismaService) {
    super();
  }

  async upsert(challenge: AuthChallenge): Promise<void> {
    const data = { message: challenge.message, expiresAt: challenge.expiresAt };
    await this.prisma.authChallenge.upsert({ where: { wallet: challenge.wallet }, create: { wallet: challenge.wallet, ...data }, update: data });
  }

  /** DELETE … RETURNING is one atomic statement: of two concurrent verifies exactly one gets the row. */
  async consume(wallet: string): Promise<AuthChallenge | null> {
    const rows = await this.prisma.$queryRaw<ChallengeRow[]>`DELETE FROM "player"."AuthChallenge" WHERE wallet = ${wallet} RETURNING wallet, message, "expiresAt"`;
    const row = rows[0];
    return row ? new AuthChallenge(row.wallet, row.message, row.expiresAt) : null;
  }
}
