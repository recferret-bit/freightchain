export class GetConvoyLeaderboardQuery {
  constructor(public readonly wallet: string) {}
}

export class BindConvoyCommand {
  constructor(public readonly wallet: string, public readonly code: string) {}
}

export class SetConvoyPrivacyCommand {
  constructor(public readonly wallet: string, public readonly convoyHidden: boolean) {}
}
