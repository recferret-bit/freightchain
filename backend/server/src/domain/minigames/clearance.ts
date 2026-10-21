export interface ForbiddenSpan {
  /** metres along the road */
  start: number;
  end: number;
}

/**
 * Move `distance` forward until it sits more than `clearance` metres clear of every forbidden span
 * (a hole or a junction). The schedule does not read the road: arm times are placed in time and slotS stays null.
 * Call this when a distance is known.
 */
export function shiftPastForbidden(distance: number, forbidden: readonly ForbiddenSpan[], clearance = 300): number {
  let d = distance;
  for (let pass = 0; pass < forbidden.length + 1; pass++) {
    let moved = false;
    for (const iv of forbidden) {
      const lo = Math.min(iv.start, iv.end) - clearance;
      const hi = Math.max(iv.start, iv.end) + clearance;
      if (d >= lo && d <= hi) {
        d = hi + 0.001;
        moved = true;
      }
    }
    if (!moved) return d;
  }
  return d;
}
