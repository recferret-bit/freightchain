import type { SignedToken } from '../../../../domain/auth/auth-challenge.entity.js';
import type { ClientInfo } from '../../../../domain/auth/sign-in.js';
import type { MeDto } from '../../../../domain/players/player.dto.js';

export class VerifySignInCommand {
  public readonly wallet: string;
  public readonly signature: string;
  public readonly client: ClientInfo;
  public readonly message?: string;
  public readonly nonce?: string;

  constructor(
    wallet: string,
    signature: string,
    a?: ClientInfo | string,
    b?: ClientInfo | string,
    c?: ClientInfo | string,
  ) {
    this.wallet = wallet;
    this.signature = signature;

    let client: ClientInfo = { ip: null, userAgent: null };
    let message: string | undefined;
    let nonce: string | undefined;

    if (a && typeof a === 'object') {
      client = a;
      if (typeof b === 'string') message = b;
      if (typeof c === 'string') nonce = c;
    } else if (typeof a === 'string') {
      message = a;
      if (typeof b === 'string') {
        nonce = b;
        if (c && typeof c === 'object') client = c;
      } else if (b && typeof b === 'object') {
        client = b;
      }
    }

    this.client = client;
    this.message = message;
    this.nonce = nonce;
  }
}

/** The profile goes to the client as the response body; the session token only as the httpOnly cookie (set by the controller's interceptor). */
export interface SignInResultDto {
  profile: MeDto;
  session: SignedToken;
}
