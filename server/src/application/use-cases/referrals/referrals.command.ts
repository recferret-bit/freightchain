export class GetReferralsQuery {
  constructor(public readonly wallet: string) {}
}

export class BindReferralCommand {
  constructor(
    public readonly wallet: string,
    public readonly code: string,
  ) {}
}

export class SetReferralGiftCommand {
  constructor(
    public readonly wallet: string,
    public readonly item: string,
  ) {}
}
