/** A desktop asks for a code. `secret` is set as the httpOnly cookie and removed from the JSON. */
export class OpenPhonePairCommand {}
export interface OpenPhonePairDto { id: string; expiresAt: string; secret: string }

/** The phone just signed in. Its session cookie is stored against the code for the desktop to adopt. */
export class ClaimPhonePairCommand {
  constructor(public readonly id: string, public readonly token: string | null) {}
}

/** The desktop that holds the secret cookie. `token` is set as the session cookie and removed from the JSON. */
export class PollPhonePairCommand {
  constructor(public readonly id: string, public readonly secret: string | null) {}
}
export interface PollPhonePairDto { status: 'pending' | 'ready'; wallet?: string; token?: string }
