import { Injectable } from '@nestjs/common';
import { SitePresencePort } from '../../application/ports/live/site-presence.port.js';

const WINDOW_MS = 30_000;       // the lobby polls every 5 s, the landing every 10 s
const PER_SOURCE = 3;           // ids counted per client IP – a script inventing ids can't pump "N online"
const MAX_VISITORS = 50_000;    // bounded memory: beyond this the stalest visitor is dropped

interface Seen { source: string; page: string; wallet: string | null; at: number }

/** In-process presence (one app container in production). Kept in last-seen order (delete + set): expiry and eviction are O(1) per entry. */
@Injectable()
export class MemorySitePresenceAdapter extends SitePresencePort {
  private readonly visitors = new Map<string, Seen>();
  private readonly perSource = new Map<string, number>();

  seen(source: string, visitor: string, page: string, wallet: string | null, now: Date): void {
    const at = now.getTime();
    this.expire(at);
    const key = `${source}|${visitor}`;
    if (this.visitors.has(key)) this.visitors.delete(key);
    else {
      if ((this.perSource.get(source) ?? 0) >= PER_SOURCE) return;
      if (this.visitors.size >= MAX_VISITORS) this.drop(this.visitors.keys().next().value as string);
      this.perSource.set(source, (this.perSource.get(source) ?? 0) + 1);
    }
    this.visitors.set(key, { source, page, wallet, at });
  }

  leave(source: string, visitor: string): void {
    this.drop(`${source}|${visitor}`);
  }

  snapshot(now: Date): { visitors: number; wallets: Set<string> } {
    this.expire(now.getTime());
    const wallets = new Set<string>();
    for (const v of this.visitors.values()) if (v.wallet) wallets.add(v.wallet);
    return { visitors: this.visitors.size, wallets };
  }

  private expire(at: number): void {
    for (const [key, v] of this.visitors) { if (v.at >= at - WINDOW_MS) break; this.drop(key); }
  }

  private drop(key: string): void {
    const v = this.visitors.get(key);
    if (!v) return;
    this.visitors.delete(key);
    const n = (this.perSource.get(v.source) ?? 1) - 1;
    if (n > 0) this.perSource.set(v.source, n); else this.perSource.delete(v.source);
  }
}
