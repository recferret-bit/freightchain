import { CommandBus, CommandHandler, type ICommandHandler } from '@nestjs/cqrs';
import { SettleChainSignatureCommand, type SettledSignatureDto } from '../settle-chain-signature/settle-chain-signature.command.js';
import { ReceiveChainWebhookCommand, type ChainWebhookResultDto } from './receive-chain-webhook.command.js';

/**
 * Each signature of the delivery → SettleChainSignatureCommand, in order (it reads the transaction back from the chain – the body is not trusted). Idempotent,
 * so a re-delivery, the poll or the confirm fast path settling the same transaction is harmless. An error (RPC down, database busy) fails the delivery as a whole:
 * the provider re-delivers it and what was settled already answers as settled again.
 */
@CommandHandler(ReceiveChainWebhookCommand)
export class ReceiveChainWebhookHandler implements ICommandHandler<ReceiveChainWebhookCommand, ChainWebhookResultDto> {
  constructor(private readonly commands: CommandBus) {}

  async execute({ signatures }: ReceiveChainWebhookCommand): Promise<ChainWebhookResultDto> {
    let settled = 0, pending = 0;
    for (const signature of signatures) {
      const r = await this.commands.execute<SettleChainSignatureCommand, SettledSignatureDto>(new SettleChainSignatureCommand(signature));
      if (r.status === 'done') settled++;
      else if (r.status === 'pending') pending++;
    }
    return { received: signatures.length, settled, pending };
  }
}
