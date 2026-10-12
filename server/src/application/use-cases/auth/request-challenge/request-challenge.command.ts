/** `origin` = the requesting page's Origin header: the game host (ride.<apex>) gets a message naming it, anything else the app's own domain.
 * `wallet` is optional for 1-click SIWS (where wallet is selected/approved in the native sign-in dialog).
 */
export class RequestChallengeCommand {
  public readonly wallet: string | null;
  public readonly origin: string | null;

  constructor(
    wallet?: string | null,
    origin: string | null = null,
  ) {
    this.wallet = wallet ?? null;
    this.origin = origin;
  }
}

export interface ChallengeDto {
  /** the exact text the wallet must sign (legacy formatted text or standard SIWS message) */
  message: string;
  domain?: string;
  statement?: string;
  uri?: string;
  version?: string;
  chainId?: string;
  nonce?: string;
  issuedAt?: string;
  expirationTime?: string;
  address?: string;
}
