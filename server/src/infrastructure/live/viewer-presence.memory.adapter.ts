import { Injectable } from '@nestjs/common';
import { ViewerPresencePort } from '../../application/ports/live/viewer-presence.port.js';
import { VIEWER_WINDOW_MS } from '../../domain/live/live-rules.js';

const MAX_RIDES = 2000; // bounded memory: beyond this the stalest ride is forgotten
const MAX_VIEWERS = 5000; // per ride

/** In-process viewer counter (one app container in production). Not persisted: a restart starts from zero, and the count is a soft number anyway. */
@Injectable()
export class MemoryViewerPresenceAdapter extends ViewerPresencePort {
  private readonly rides = new Map<string, Map<string, number>>();

  seen(rideId: string, viewer: string, now: Date): number {
    let viewers = this.rides.get(rideId);
    if (!viewers) {
      if (this.rides.size >= MAX_RIDES) this.forgetStalest();
      viewers = new Map();
      this.rides.set(rideId, viewers);
    }
    viewers.delete(viewer); // re-insert: the map stays ordered by last poll, oldest first
    if (viewers.size < MAX_VIEWERS) viewers.set(viewer, now.getTime());
    return this.count(rideId, now);
  }

  count(rideId: string, now: Date): number {
    const viewers = this.rides.get(rideId);
    if (!viewers) return 0;
    const cutoff = now.getTime() - VIEWER_WINDOW_MS;
    for (const [viewer, at] of viewers) { if (at >= cutoff) break; viewers.delete(viewer); }
    if (!viewers.size) this.rides.delete(rideId);
    return viewers.size;
  }

  private forgetStalest(): void {
    let stalest: string | null = null, oldest = Infinity;
    for (const [rideId, viewers] of this.rides) {
      const last = [...viewers.values()].pop() ?? 0;
      if (last < oldest) { oldest = last; stalest = rideId; }
    }
    if (stalest) this.rides.delete(stalest);
  }
}
