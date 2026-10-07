import type { AdminIntent } from '../../../../domain/admin/admin-proof.js';

/** The text for the admin's wallet to sign before one change (an override or a re-judge of one ride). */
export class RequestActionChallengeCommand {
  constructor(
    public readonly admin: string,
    public readonly intent: AdminIntent,
  ) {}
}
