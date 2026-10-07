import type { Connection } from '@solana/web3.js';
import { ServiceUnavailableError } from '../../domain/shared/errors.js';

export const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/* The RPC endpoints (docs/paid-tickets-plan.md §2.9 "Congestion"): READS go to the primary and, when it fails, to each SOLANA_RPC_FALLBACKS endpoint in turn with an
   exponential backoff (250 ms, 500 ms, …); WRITES (sending a transaction) only ever go to the primary – a public fallback must never be the one that relays our
   transactions – and so do reads whose "nothing there" answer would be acted on (is a signature unknown? a fallback without full history would say so wrongly).
   A failure everywhere is "unavailable" (503), never "not found". */
export class SolanaRpc {
  constructor(
    readonly primary: Connection,
    private readonly fallbacks: readonly Connection[] = [],
    private readonly wait: (ms: number) => Promise<void> = sleep,
    private readonly backoffMs = 250,
  ) {}

  async read<T>(call: (c: Connection) => Promise<T>): Promise<T> {
    const endpoints = [this.primary, ...this.fallbacks];
    for (let i = 0; i < endpoints.length; i++) {
      if (i > 0) await this.wait(this.backoffMs * 2 ** (i - 1));
      try {
        return await call(endpoints[i]!);
      } catch {
        // next endpoint
      }
    }
    throw new ServiceUnavailableError('Solana RPC unavailable');
  }

  /** the primary only: sends, and reads that must not come from a node with less history */
  async primaryOnly<T>(call: (c: Connection) => Promise<T>): Promise<T> {
    try {
      return await call(this.primary);
    } catch {
      throw new ServiceUnavailableError('Solana RPC unavailable');
    }
  }
}
