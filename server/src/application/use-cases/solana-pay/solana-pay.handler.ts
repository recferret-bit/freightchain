import { QueryBus, QueryHandler, type IQueryHandler } from '@nestjs/cqrs';
import { RulesConfigPort } from '../../ports/config/rules-config.port.js';
import { GetDonationPaymentQuery, type DonationPaymentDto } from '../live/get-donation-payment/get-donation-payment.query.js';
import { GetPaymentInstructionsQuery, type PaymentInstructionsDto } from '../rides/get-payment-instructions/get-payment-instructions.query.js';
import { GetTicketPaymentQuery, type TicketPaymentDto } from '../tickets/get-ticket-payment/get-ticket-payment.query.js';
import { GetSolanaPayLinkQuery, GetSolanaPayTransactionQuery, type SolanaPayLinkDto, type SolanaPayTransactionDto } from './solana-pay.query.js';

@QueryHandler(GetSolanaPayLinkQuery)
export class GetSolanaPayLinkHandler implements IQueryHandler<GetSolanaPayLinkQuery, SolanaPayLinkDto> {
  constructor(private readonly rules: RulesConfigPort) {}

  async execute(): Promise<SolanaPayLinkDto> {
    const origin = this.rules.get().appOrigin.replace(/\/$/, '');
    return { label: 'Freight Chain', icon: `${origin}/icons/icon-512.png` };
  }
}

const MESSAGE = { ride: 'Freight Chain shift · devnet', order: 'Freight Chain tickets · devnet', donation: 'Freight Chain donation · devnet' } as const;

/** The phone has no session. `account` is the wallet that must sign, and the existing builders reject any other. */
@QueryHandler(GetSolanaPayTransactionQuery)
export class GetSolanaPayTransactionHandler implements IQueryHandler<GetSolanaPayTransactionQuery, SolanaPayTransactionDto> {
  constructor(private readonly queryBus: QueryBus) {}

  async execute({ kind, id, account }: GetSolanaPayTransactionQuery): Promise<SolanaPayTransactionDto> {
    const transaction = kind === 'ride'
      ? (await this.queryBus.execute<GetPaymentInstructionsQuery, PaymentInstructionsDto>(new GetPaymentInstructionsQuery(account, id))).transaction
      : kind === 'order'
        ? (await this.queryBus.execute<GetTicketPaymentQuery, TicketPaymentDto>(new GetTicketPaymentQuery(account, id))).transaction
        : (await this.queryBus.execute<GetDonationPaymentQuery, DonationPaymentDto>(new GetDonationPaymentQuery(account, id))).transaction;
    return { transaction, message: MESSAGE[kind] };
  }
}
