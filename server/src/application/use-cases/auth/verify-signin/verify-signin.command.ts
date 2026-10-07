import type { SignedToken } from '../../../../domain/auth/auth-challenge.entity.js';
import type { MeDto } from '../../../../domain/players/player.dto.js';

export class VerifySignInCommand {
  constructor(
    public readonly wallet: string,
    public readonly signature: string,
  ) {}
}

/** The profile goes to the client as the response body; the session token only as the httpOnly cookie (set by the controller's interceptor). */
export interface SignInResultDto {
  profile: MeDto;
  session: SignedToken;
}
