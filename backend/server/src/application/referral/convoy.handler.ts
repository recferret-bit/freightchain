import { CommandHandler, QueryHandler, type ICommandHandler, type IQueryHandler } from '@nestjs/cqrs';
import { ConflictError, BadRequestError } from '../../domain/shared/errors.js';
import { isReferralCode } from '../../domain/referral/referral-rules.js';
import { ReferralRepositoryPort } from '../ports/referral/referral.repository.port.js';
import { BindConvoyCommand, GetConvoyLeaderboardQuery, SetConvoyPrivacyCommand } from './convoy.command.js';
import { ConvoyService, type ConvoyBindDto, type ConvoyLeaderboardDto, type ConvoyPrivacyDto } from './convoy.service.js';

@QueryHandler(GetConvoyLeaderboardQuery)
export class GetConvoyLeaderboardHandler implements IQueryHandler<GetConvoyLeaderboardQuery, ConvoyLeaderboardDto> {
  constructor(private readonly convoy: ConvoyService) {}
  execute({ wallet }: GetConvoyLeaderboardQuery): Promise<ConvoyLeaderboardDto> {
    return this.convoy.leaderboard(wallet);
  }
}

@CommandHandler(BindConvoyCommand)
export class BindConvoyHandler implements ICommandHandler<BindConvoyCommand, ConvoyBindDto> {
  constructor(private readonly convoy: ConvoyService, private readonly referrals: ReferralRepositoryPort) {}
  async execute({ wallet, code }: BindConvoyCommand): Promise<ConvoyBindDto> {
    if (!isReferralCode(code)) throw new BadRequestError('a referral code is 8 letters or digits', 'bad_code');
    const owner = await this.referrals.codeByCode(code);
    if (!owner) throw new ConflictError('unknown referral code', 'unknown_code');
    return this.convoy.bind(wallet, owner.wallet);
  }
}

@CommandHandler(SetConvoyPrivacyCommand)
export class SetConvoyPrivacyHandler implements ICommandHandler<SetConvoyPrivacyCommand, ConvoyPrivacyDto> {
  constructor(private readonly convoy: ConvoyService) {}
  execute({ wallet, convoyHidden }: SetConvoyPrivacyCommand): Promise<ConvoyPrivacyDto> {
    return this.convoy.setPrivacy(wallet, convoyHidden);
  }
}
