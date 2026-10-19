import { Injectable } from '@nestjs/common';
import { ViewerPresencePort } from '../../application/ports/live/viewer-presence.port.js';
import { VIEWERS_PER_SOURCE, VIEWER_WINDOW_MS } from '../../domain/live/live-rules.js';

const MAX_RIDES = 2000; // bounded memory: beyond this the stalest ride is forgotten
const MAX_VIEWERS = 5000; // per ride: beyond this the oldest viewer is dropped (a new one is never refused)

interface Watched { viewers: Map<string, { source: string; at: number }>; perSource: Map<string, number>; last: number }

/** In-process viewer counter (one app container in production). Not persisted: a restart starts from zero, and the count is a soft number anyway.
    Both maps are kept in last-seen order (delete + set), so the stalest ride / viewer is always the first entry: eviction and expiry are O(1) per entry. */
@Injectable()
export class MemoryViewerPresenceAdapter extends ViewerPresencePort {
  private readonly rides = new Map<string, Watched>();

  seen(rideId: string, source: string, viewer: string, now: Date): number {
    const at = now.getTime();
    let w = this.rides.get(rideId);
    if (w) this.rides.delete(rideId);
    else w = { viewers: new Map(), perSource: new Map(), last: at };
    this.rides.set(rideId, w); // most recently watched last
    w.last = at;
    this.count(rideId, now); // expire first, so an expired id frees its source's slot
    const key = `${source}|${viewer}`, known = w.viewers.get(key);
    if (known) { w.viewers.delete(key); w.viewers.set(key, { source, at }); }
    else if ((w.perSource.get(source) ?? 0) < VIEWERS_PER_SOURCE) {
      if (w.viewers.size >= MAX_VIEWERS) this.drop(w, w.viewers.keys().next().value as string);
      w.viewers.set(key, { source, at }); w.perSource.set(source, (w.perSource.get(source) ?? 0) + 1);
    }
    this.sweep(at);
    return this.count(rideId, now);
  }

  leave(rideId: string, source: string, viewer: string): void {
    const w = this.rides.get(rideId);
    if (w) this.drop(w, `${source}|${viewer}`);
  }

  count(rideId: string, now: Date): number {
    const w = this.rides.get(rideId);
    if (!w) return 0;
    const cutoff = now.getTime() - VIEWER_WINDOW_MS;
    for (const [key, v] of w.viewers) { if (v.at >= cutoff) break; this.drop(w, key); }
    return w.viewers.size;
  }

  watching(now: Date): number {
    const all = new Set<string>();
    for (const rideId of [...this.rides.keys()]) { this.count(rideId, now); for (const key of this.rides.get(rideId)?.viewers.keys() ?? []) all.add(key); }
    return all.size;
  }

  private drop(w: Watched, key: string): void {
    const v = w.viewers.get(key);
    if (!v) return;
    w.viewers.delete(key);
    const n = (w.perSource.get(v.source) ?? 1) - 1;
    if (n > 0) w.perSource.set(v.source, n); else w.perSource.delete(v.source);
  }

  /** rides nobody polled within the window (the first entries) are forgotten, and the stalest beyond the cap */
  private sweep(at: number): void {
    for (const [rideId, w] of this.rides) {
      if (this.rides.size <= MAX_RIDES && w.last >= at - VIEWER_WINDOW_MS) break;
      this.rides.delete(rideId);
    }
  }
}
