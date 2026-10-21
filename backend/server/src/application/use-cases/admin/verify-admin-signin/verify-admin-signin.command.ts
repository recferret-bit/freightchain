import type { SignedToken } from '../../../../domain/auth/auth-challenge.entity.js';
import type { ClientInfo } from '../../../../domain/auth/sign-in.js';

export class VerifyAdminSignInCommand {
  constructor(
    public readonly wallet: string,
    public readonly signature: string,
    public readonly client: ClientInfo = { ip: null, userAgent: null },
    public readonly requestId: string | null = null,
    public readonly clientId = 'default',
  ) {}
}

/** What the admin page gets back (the token itself goes only into the httpOnly fc_admin cookie). */
export interface AdminSessionDto {
  wallet: string;
  /** epoch ms – the page shows when it has to sign in again */
  expiresAt: number;
}

export interface AdminSignInResultDto {
  admin: AdminSessionDto;
  session: SignedToken;
}
