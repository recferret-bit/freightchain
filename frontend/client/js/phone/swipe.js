/** Bottom-up swipe that leaves the open app. Distances are logical pixels of the phone screen. */

export const SWIPE_BAND = 120;
export const SWIPE_RISE = 64;

/** True when the finger started in the bottom band and travelled up more than it travelled sideways. */
export function closesApp(startY, height, dx, dy) {
  if (!(height > 0) || startY < height - SWIPE_BAND) return false;
  const up = -dy;
  return up >= SWIPE_RISE && up > Math.abs(dx);
}
