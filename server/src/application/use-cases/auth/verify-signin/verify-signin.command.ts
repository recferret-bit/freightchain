import type { SignedToken } from '../../../../domain/auth/auth-challenge.entity.js';
import type { ClientInfo } from '../../../../domain/auth/sign-in.js';
import type { MeDto } from '../../../../domain/players/player.dto.js';

export class VerifySignInCommand {
  constructor(
    public readonly wallet: string,
    public readonly signature: string,
    /** where the sign-in came from (kept in the sign-in log for the admin page) */
    public readonly client: ClientInfo = { ip: null, userAgent: null },
  ) {}
}

/** The profile goes to the client as the response body; the session token only as the httpOnly cookie (set by the controller's interceptor). */
export interface SignInResultDto {
  profile: MeDto;
  session: SignedToken;
}
