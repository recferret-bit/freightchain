import type { SignedToken } from '../../../../domain/auth/auth-challenge.entity.js';
import type { ClientInfo } from '../../../../domain/auth/sign-in.js';

export class VerifyEditorSignInCommand {
  constructor(
    public readonly wallet: string,
    public readonly signature: string,
    public readonly client: ClientInfo = { ip: null, userAgent: null },
    public readonly requestId: string | null = null,
  ) {}
}

/** What the editor page gets back (the token itself goes only into the httpOnly fc_editor cookie). */
export interface EditorSessionDto {
  wallet: string;
  /** epoch ms */
  expiresAt: number;
}

export interface EditorSignInResultDto {
  editor: EditorSessionDto;
  session: SignedToken;
}
