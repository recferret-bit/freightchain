import type { ClientInfo } from '../../../../domain/auth/sign-in.js';

/** Open an anonymous EASY session. The wallet is a fresh public key; the secret is discarded. */
export class StartGuestCommand {
  constructor(public readonly client: ClientInfo) {}
}
