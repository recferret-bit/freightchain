import { CommandHandler, QueryHandler, type ICommandHandler, type IQueryHandler } from '@nestjs/cqrs';
import { ConvoyService } from '../referral/convoy.service.js';
import { AirdropService, type AirdropStatusDto } from './airdrop.service.js';
import { ClaimAirdropCommand, GetAirdropStatusQuery, VerifyTelegramCommand, VerifyXCommand } from './airdrop.command.js';

@QueryHandler(GetAirdropStatusQuery)
export class GetAirdropStatusHandler implements IQueryHandler<GetAirdropStatusQuery, AirdropStatusDto> {
  constructor(private readonly airdrop: AirdropService) {}
  execute({ wallet }: GetAirdropStatusQuery): Promise<AirdropStatusDto> {
    return this.airdrop.status(wallet);
  }
}

@CommandHandler(VerifyTelegramCommand)
export class VerifyTelegramHandler implements ICommandHandler<VerifyTelegramCommand, AirdropStatusDto> {
  constructor(private readonly airdrop: AirdropService, private readonly convoy: ConvoyService) {}
  async execute({ wallet, telegramUserId, turnstileToken, proof }: VerifyTelegramCommand): Promise<AirdropStatusDto> {
    const status = await this.airdrop.verifyTelegram(wallet, telegramUserId, turnstileToken, proof);
    await this.convoy.refreshMilestones(wallet);
    return status;
  }
}

@CommandHandler(VerifyXCommand)
export class VerifyXHandler implements ICommandHandler<VerifyXCommand, AirdropStatusDto> {
  constructor(private readonly airdrop: AirdropService, private readonly convoy: ConvoyService) {}
  async execute({ wallet, handle, postId, turnstileToken }: VerifyXCommand): Promise<AirdropStatusDto> {
    const status = await this.airdrop.verifyX(wallet, handle, postId, turnstileToken);
    await this.convoy.refreshMilestones(wallet);
    return status;
  }
}

@CommandHandler(ClaimAirdropCommand)
export class ClaimAirdropHandler implements ICommandHandler<ClaimAirdropCommand, AirdropStatusDto> {
  constructor(private readonly airdrop: AirdropService) {}
  execute({ wallet, turnstileToken }: ClaimAirdropCommand): Promise<AirdropStatusDto> {
    return this.airdrop.claim(wallet, turnstileToken);
  }
}
