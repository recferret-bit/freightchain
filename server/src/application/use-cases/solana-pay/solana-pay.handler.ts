import { QueryBus, QueryHandler, type IQueryHandler } from '@nestjs/cqrs';
import { NotFoundError } from '../../../domain/shared/errors.js';
import { RulesConfigPort } from '../../ports/config/rules-config.port.js';
import { TicketOrderRepositoryPort } from '../../ports/economy/ticket-order.repository.port.js';
import { DonationOrderRepositoryPort } from '../../ports/live/donation-order.repository.port.js';
import { RideRepositoryPort } from '../../ports/rides/ride.repository.port.js';
import { GetDonationPaymentQuery, type DonationPaymentDto } from '../live/get-donation-payment/get-donation-payment.query.js';
import { GetPaymentInstructionsQuery, type PaymentInstructionsDto } from '../rides/get-payment-instructions/get-payment-instructions.query.js';
import { GetTicketPaymentQuery, type TicketPaymentDto } from '../tickets/get-ticket-payment/get-ticket-payment.query.js';
import { GetSolanaPayLinkQuery, GetSolanaPayTransactionQuery, type SolanaPayLinkDto, type SolanaPayTransactionDto } from './solana-pay.query.js';

@QueryHandler(GetSolanaPayLinkQuery)
export class GetSolanaPayLinkHandler implements IQueryHandler<GetSolanaPayLinkQuery, SolanaPayLinkDto> {
  constructor(private readonly rules: RulesConfigPort) {}

  async execute(_query: GetSolanaPayLinkQuery): Promise<SolanaPayLinkDto> {
    const origin = this.rules.get().appOrigin.replace(/\/$/, '');
    return { label: 'Freight Chain', icon: `${origin}/icons/icon-512.png` };
  }
}

const MESSAGE = { ride: 'Freight Chain shift · devnet', order: 'Freight Chain tickets · devnet', donation: 'Freight Chain donation · devnet' } as const;

const short = (a: string) => `${a.slice(0, 4)}…${a.slice(-4)}`;

/** The phone has no session. `account` is the wallet that must sign, and the existing builders reject any other – the wallet then shows which account the code is for
 *  (the Ticket and any refund belong to the signer, so another wallet may not pay it). Only the short form: the address is public on chain anyway, the id is unguessable. */
@QueryHandler(GetSolanaPayTransactionQuery)
export class GetSolanaPayTransactionHandler implements IQueryHandler<GetSolanaPayTransactionQuery, SolanaPayTransactionDto> {
  constructor(
    private readonly queryBus: QueryBus,
    private readonly rides: RideRepositoryPort,
    private readonly orders: TicketOrderRepositoryPort,
    private readonly donations: DonationOrderRepositoryPort,
  ) {}

  async execute(query: GetSolanaPayTransactionQuery): Promise<SolanaPayTransactionDto> {
    try {
      return await this.build(query);
    } catch (error) {
      if (!(error instanceof NotFoundError)) throw error;
      const owner = await this.ownerOf(query.kind, query.id);
      if (owner && owner !== query.account) throw new NotFoundError(`This code is for the wallet ${short(owner)} – pay it from the wallet app that holds that account (on devnet).`, 'wrong_account');
      throw error;
    }
  }

  private async ownerOf(kind: GetSolanaPayTransactionQuery['kind'], id: string): Promise<string | null> {
    const row = kind === 'ride' ? await this.rides.findById(id) : kind === 'order' ? await this.orders.findById(id) : await this.donations.findById(id);
    return row?.wallet ?? null;
  }

  private async build({ kind, id, account }: GetSolanaPayTransactionQuery): Promise<SolanaPayTransactionDto> {
    const transaction = kind === 'ride'
      ? (await this.queryBus.execute<GetPaymentInstructionsQuery, PaymentInstructionsDto>(new GetPaymentInstructionsQuery(account, id))).transaction
      : kind === 'order'
        ? (await this.queryBus.execute<GetTicketPaymentQuery, TicketPaymentDto>(new GetTicketPaymentQuery(account, id))).transaction
        : (await this.queryBus.execute<GetDonationPaymentQuery, DonationPaymentDto>(new GetDonationPaymentQuery(account, id))).transaction;
    return { transaction, message: MESSAGE[kind] };
  }
}
