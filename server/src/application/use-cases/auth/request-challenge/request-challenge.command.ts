/** `origin` = the requesting page's Origin header: the game host (ride.<apex>) gets a message naming it, anything else the app's own domain. */
export class RequestChallengeCommand {
  constructor(
    public readonly wallet: string,
    public readonly origin: string | null = null,
  ) {}
}

export interface ChallengeDto {
  /** the exact text the wallet must sign */
  message: string;
}
