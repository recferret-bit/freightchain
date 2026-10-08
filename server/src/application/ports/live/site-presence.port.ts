/** Who has a page of the site open right now (landing, lobby) – from the pages' own /api/live polls. In memory: a restart starts from zero, a soft number. */
export abstract class SitePresencePort {
  /** `visitor` (the page's random id) from `source` (the client IP) is on `page`, signed in as `wallet` (null = anonymous); at most a few ids count per source */
  abstract seen(source: string, visitor: string, page: string, wallet: string | null, now: Date): void;
  /** distinct visitors polled within the window, and the signed-in wallets among them */
  abstract snapshot(now: Date): { visitors: number; wallets: Set<string> };
}
