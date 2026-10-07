export class RequestChallengeCommand {
  constructor(public readonly wallet: string) {}
}

export interface ChallengeDto {
  /** the exact text the wallet must sign */
  message: string;
}
