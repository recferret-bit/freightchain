/* Phone tilt → where spawned SOL should fall, in viewport px (x right, y down). Length is at most 1 (fractions of g).
   ax, ay are accelerationIncludingGravity in the device frame (x toward the right edge, y toward the top): the spec's
   proper acceleration, which points UP, in m/s². `angle` is screen.orientation.angle, degrees counter-clockwise from the natural portrait.
   iOS reports the opposite sign of this; the caller flips ax/ay before calling. */
const G = 9.81;
export function fallOnScreen(ax, ay, angle) {
  const dx = -ax / G, dy = ay / G, φ = (((angle % 360) + 360) % 360) * Math.PI / 180, c = Math.cos(φ), s = Math.sin(φ);
  // Screen y points down: undo the device's counter-clockwise rotation in these canvas axes.
  let x = dx * c + dy * s, y = -dx * s + dy * c, m = Math.hypot(x, y);
  if (m > 1) { x /= m; y /= m; }
  return { x, y };
}
