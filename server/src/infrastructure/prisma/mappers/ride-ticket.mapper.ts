import type { RideTicket as RideTicketRow, TicketGrant as TicketGrantRow, TicketSource as TicketSourceRow } from '@prisma/client';
import { RideTicket } from '../../../domain/players/ride-ticket.entity.js';
import type { TicketGrantProps, TicketSource } from '../../../domain/players/ride-ticket.types.js';

export class RideTicketMapper {
  static toDomain(row: RideTicketRow): RideTicket {
    return RideTicket.restore({ wallet: row.wallet, poolId: row.poolId, balance: row.balance, bought: row.bought, version: row.version });
  }

  static grantToDomain(row: TicketGrantRow): TicketGrantProps {
    return { wallet: row.wallet, poolId: row.poolId, delta: row.delta, source: row.source as TicketSource, ref: row.ref, at: row.at };
  }

  static grantToData(g: TicketGrantProps) {
    return { wallet: g.wallet, poolId: g.poolId, delta: g.delta, source: g.source as TicketSourceRow, ref: g.ref, at: g.at };
  }
}
