import type { Round as RoundRow, RoundStatus as RoundStatusRow } from '@prisma/client';
import { Round, RoundStatus } from '../../../domain/economy/round.entity.js';

export class RoundMapper {
  static toDomain(row: RoundRow): Round {
    return Round.restore({ id: row.id, startsAt: row.startsAt, endsAt: row.endsAt, carry: Number(row.carry), status: row.status as unknown as RoundStatus });
  }

  static toCreateData(round: Round) {
    const s = round.snapshot();
    return { startsAt: s.startsAt, endsAt: s.endsAt, carry: BigInt(s.carry), status: s.status as unknown as RoundStatusRow };
  }
}
