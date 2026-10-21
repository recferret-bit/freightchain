import { QueryHandler, type IQueryHandler } from '@nestjs/cqrs';
import type { TipHistoryRow } from '../ports/live/ride-event.repository.port.js';
import { RideEventRepositoryPort } from '../ports/live/ride-event.repository.port.js';
import { GetMyDonationsQuery } from './get-my-donations.query.js';

export interface MyDonationDto {
  id: number;
  rideId: string;
  fromWallet: string;
  toWallet: string;
  lamports: number;
  note: string | null;
  signature: string | null;
  at: number;
}

export interface MyDonationsDto {
  sent: MyDonationDto[];
  received: MyDonationDto[];
  totals: { sentLamports: number; receivedLamports: number };
}

const toDto = (row: TipHistoryRow): MyDonationDto => ({
  id: row.id, rideId: row.rideId, fromWallet: row.fromWallet, toWallet: row.toWallet, lamports: row.lamports, note: row.note, signature: row.signature, at: row.at.getTime(),
});

const sum = (rows: readonly MyDonationDto[]): number => rows.reduce((total, row) => total + row.lamports, 0);

@QueryHandler(GetMyDonationsQuery)
export class GetMyDonationsHandler implements IQueryHandler<GetMyDonationsQuery, MyDonationsDto> {
  constructor(private readonly events: RideEventRepositoryPort) {}

  async execute({ wallet }: GetMyDonationsQuery): Promise<MyDonationsDto> {
    const history = await this.events.tipsFor(wallet, 50);
    const sent = history.sent.map(toDto);
    const received = history.received.map(toDto);
    return { sent, received, totals: { sentLamports: sum(sent), receivedLamports: sum(received) } };
  }
}
