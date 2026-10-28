/** A signed admin lock of the final winners (`AdminIntent` event_lock): only after the appeals window closed. */
export class LockEventListCommand {
  constructor(public readonly admin: string, public readonly requestId: string | null, public readonly signature: string) {}
}

export interface EventLockedDto { eventId: string; lockedAt: number; winners: number; paidCents: number; organizerCents: number }
