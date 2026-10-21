export class RequestAdminChallengeCommand {
  constructor(public readonly wallet: string, public readonly clientId = 'default') {}
}
