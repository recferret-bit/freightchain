import type { ChainEventKind, ChainEventOutcome } from '../../../../domain/economy/chain-events.js';

/** Settle everything the pool program did in one transaction. Sent by the confirm fast path, the webhook and the program-log watcher – all idempotent. */
export class SettleChainSignatureCommand {
  constructor(public readonly signature: string) {}
}

export interface SettledEventDto {
  index: number;
  kind: ChainEventKind;
  poolId: number;
  outcome: ChainEventOutcome;
  /** the order a purchase paid (or the one adopted from it) */
  orderId: string | null;
  detail: string | null;
}

export interface SettledSignatureDto {
  signature: string;
  /** pending = not visible at the configured commitment yet (ask again) · invalid = failed or not a pool program transaction · done = every event handled */
  status: 'pending' | 'invalid' | 'done';
  detail: string | null;
  events: SettledEventDto[];
}
