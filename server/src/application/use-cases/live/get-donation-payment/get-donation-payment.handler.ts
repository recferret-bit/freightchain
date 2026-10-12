import { QueryHandler, type IQueryHandler } from '@nestjs/cqrs';
import { ConflictError, NotFoundError } from '../../../../domain/shared/errors.js';
import { ChainPort } from '../../../ports/economy/chain.port.js';
import { DonationOrderRepositoryPort } from '../../../ports/live/donation-order.repository.port.js';
import { EntropyPort } from '../../../ports/shared/entropy.port.js';
import { GetDonationPaymentQuery, type DonationPaymentDto } from './get-donation-payment.query.js';

/** The unsigned transfer again. The reference is the one stored at create; an older order gets one here, and a racing rebuild keeps the first. */
@QueryHandler(GetDonationPaymentQuery)
export class GetDonationPaymentHandler implements IQueryHandler<GetDonationPaymentQuery, DonationPaymentDto> {
  constructor(
    private readonly orders: DonationOrderRepositoryPort,
    private readonly chain: ChainPort,
    private readonly entropy: EntropyPort,
  ) {}

  async execute({ wallet, orderId }: GetDonationPaymentQuery): Promise<DonationPaymentDto> {
    const order = await this.orders.findById(orderId);
    if (!order || order.wallet !== wallet) throw new NotFoundError('donation not found');
    if (order.status !== 'pending') throw new ConflictError('this donation is already paid', 'already_paid');
    const reference = await this.referenceOf(orderId, order.paymentReference);
    const tx = await this.chain.buildPaymentTransaction({ payer: wallet, treasury: order.recipient, lamports: order.lamports, memo: order.memo, reference });
    return { transaction: tx.transaction, reference };
  }

  private async referenceOf(orderId: string, existing: string | null): Promise<string> {
    if (existing) return existing;
    const key = this.entropy.referenceKey();
    await this.orders.setReference(orderId, key);
    return (await this.orders.findById(orderId))?.paymentReference ?? key;
  }
}
