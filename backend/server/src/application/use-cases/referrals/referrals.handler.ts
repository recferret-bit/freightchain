import { CommandHandler, QueryHandler, type ICommandHandler, type IQueryHandler } from '@nestjs/cqrs';
import { ReferralService, type ReferralView } from '../../services/referral.service.js';
import { BindReferralCommand, GetReferralsQuery, SetReferralGiftCommand } from './referrals.command.js';

@QueryHandler(GetReferralsQuery)
export class GetReferralsHandler implements IQueryHandler<GetReferralsQuery, ReferralView> {
  constructor(private readonly referrals: ReferralService) {}
  execute({ wallet }: GetReferralsQuery): Promise<ReferralView> { return this.referrals.view(wallet); }
}

@CommandHandler(BindReferralCommand)
export class BindReferralHandler implements ICommandHandler<BindReferralCommand, ReferralView> {
  constructor(private readonly referrals: ReferralService) {}
  async execute({ wallet, code }: BindReferralCommand): Promise<ReferralView> {
    await this.referrals.bind(wallet, code);
    return this.referrals.view(wallet);
  }
}

@CommandHandler(SetReferralGiftCommand)
export class SetReferralGiftHandler implements ICommandHandler<SetReferralGiftCommand, ReferralView> {
  constructor(private readonly referrals: ReferralService) {}
  execute({ wallet, item }: SetReferralGiftCommand): Promise<ReferralView> { return this.referrals.gift(wallet, item); }
}
