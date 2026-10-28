// Pure test-driver helper: is a lateral move into `lat` clear for the whole move? The driver only observes cars; it never edits them.
// Serialized into the browser with Function.prototype.toString, so it must stay self-contained.
// Cars: { s, lat, v, dir, road:{main} }. Truck: { s, v, d }. Same-direction cars close at (truck v − car v); oncoming (dir < 0) at (truck v + car v).
export function laneMergeUnsafe(cars, truck, lat, { moveSeconds = 3.2, margin = 1.6, aheadGap = 14, behindGap = 10, width = 3 } = {}) {
  const horizon = moveSeconds + margin;   // the move itself plus the time to settle
  for (const c of cars) {
    if (!c.road?.main || Math.abs(c.lat - lat) >= width) continue;
    const gap = c.s - truck.s;   // + ahead, − behind
    const closing = c.dir < 0 ? truck.v + c.v : truck.v - c.v;
    if (gap >= -behindGap && gap <= aheadGap) return true;                 // already alongside
    if (gap > aheadGap) {   // ahead in the target lane: the gap left after the move must still hold a time headway
      if (gap - Math.max(0, closing) * horizon < aheadGap + .4 * truck.v) return true;
    } else if (c.dir >= 0 && c.v > truck.v) {   // a faster car behind reaches us mid-move
      if (-gap - (c.v - truck.v) * horizon < behindGap + .3 * c.v) return true;
    }
  }
  return false;
}
