/** Who has a page of the site open right now (landing, lobby) – from the pages' own /api/live polls. Shared in Redis when configured, in-memory otherwise. */
export abstract class SitePresencePort {
  /** `visitor` (the page's random id) from `source` (the client IP) is on `page`, signed in as `wallet` (null = anonymous); at most a few ids count per source */
  abstract seen(source: string, visitor: string, page: string, wallet: string | null, now: Date): void | Promise<void>;
  /** the page is closing (its pagehide beacon): it stops counting now instead of after the window */
  abstract leave(source: string, visitor: string): void | Promise<void>;
  /** distinct visitors polled within the window, and the signed-in wallets among them */
  abstract snapshot(now: Date): { visitors: number; wallets: Set<string> } | Promise<{ visitors: number; wallets: Set<string> }>;
}
