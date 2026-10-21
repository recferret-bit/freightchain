export class GetAirdropStatusQuery {
  constructor(public readonly wallet: string) {}
}

export class VerifyTelegramCommand {
  constructor(public readonly wallet: string, public readonly telegramUserId: string, public readonly turnstileToken?: string) {}
}

export class VerifyXCommand {
  constructor(public readonly wallet: string, public readonly handle: string, public readonly postId: string, public readonly turnstileToken?: string) {}
}

export class ClaimAirdropCommand {
  constructor(public readonly wallet: string, public readonly turnstileToken?: string) {}
}
