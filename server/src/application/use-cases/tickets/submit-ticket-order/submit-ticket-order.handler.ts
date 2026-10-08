import { CommandBus, CommandHandler, type ICommandHandler } from '@nestjs/cqrs';
import { toTicketOrderDto } from '../../../../domain/economy/ticket-order.dto.js';
import { startOfUtcDay } from '../../../../domain/shared/time.js';
import { ConflictError, NotFoundError, TooManyRequestsError } from '../../../../domain/shared/errors.js';
import { RulesConfigPort } from '../../../ports/config/rules-config.port.js';
import { PoolChainPort } from '../../../ports/economy/pool-chain.port.js';
import { SponsoredTxRepositoryPort } from '../../../ports/economy/sponsored-tx.repository.port.js';
import { TicketOrderRepositoryPort } from '../../../ports/economy/ticket-order.repository.port.js';
import { ClockPort } from '../../../ports/shared/clock.port.js';
import { SettleChainSignatureCommand, type SettledSignatureDto } from '../../chain/settle-chain-signature/settle-chain-signature.command.js';
import { SubmitTicketOrderCommand, type SubmitTicketOrderResultDto } from './submit-ticket-order.command.js';

/** Base fee per signature – the sponsor's ledger records what it at least paid (the priority fee on top is in the quote, not known exactly after the fact). */
const BASE_FEE_LAMPORTS = 5_000;

/**
 * The gasless path: the wallet signed the server-built transaction; the gas sponsor adds its fee-payer signature and sends it. The adapter refuses any bytes
 * that differ from the message kept on the order (the security boundary – see PoolChainPort.cosignAndSend). The wallet's daily sponsorship cap is checked
 * first (429 → the client pays its own fee). Once it landed, the signature is settled like a confirm.
 */
@CommandHandler(SubmitTicketOrderCommand)
export class SubmitTicketOrderHandler implements ICommandHandler<SubmitTicketOrderCommand, SubmitTicketOrderResultDto> {
  constructor(
    private readonly orders: TicketOrderRepositoryPort,
    private readonly sponsored: SponsoredTxRepositoryPort,
    private readonly chain: PoolChainPort,
    private readonly commands: CommandBus,
    private readonly rules: RulesConfigPort,
    private readonly clock: ClockPort,
  ) {}

  async execute({ wallet, orderId, signedTransaction }: SubmitTicketOrderCommand): Promise<SubmitTicketOrderResultDto> {
    const rules = this.rules.get();
    const order = await this.orders.findById(orderId);
    if (!order || order.wallet !== wallet) throw new NotFoundError('no such order');
    const now = this.clock.now();
    if (!order.isLive(now, rules.orderTtlMs)) throw new ConflictError(`order is ${order.status === 'awaiting_payment' ? 'expired' : order.status}`, 'order_closed');
    const { txMessage, lastValidBlockHeight } = order.snapshot();
    if (!txMessage || lastValidBlockHeight === null) throw new ConflictError('ask for the payment transaction first', 'no_transaction');
    if ((await this.sponsored.countSince(wallet, startOfUtcDay(now))) >= rules.sponsorPerWalletPerDay) {
      throw new TooManyRequestsError(`the network fee is sponsored for ${rules.sponsorPerWalletPerDay} transactions a day – pay this one yourself`, 'sponsor_cap');
    }
    const { signature } = await this.chain.cosignAndSend({ signedTransaction, expectedMessage: txMessage, lastValidBlockHeight });
    await this.sponsored.record({ signature, wallet, kind: 'buy', feeLamports: BASE_FEE_LAMPORTS * 2, at: this.clock.now() });
    const settled = await this.commands.execute<SettleChainSignatureCommand, SettledSignatureDto>(new SettleChainSignatureCommand(signature));
    const fresh = (await this.orders.findById(orderId))!;
    const paid = settled.status === 'done' && fresh.status === 'paid' && fresh.signature === signature;
    return { signature, status: paid ? 'paid' : 'pending', order: toTicketOrderDto(fresh, rules.orderTtlMs) };
  }
}
