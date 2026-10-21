/* PIKE toll gates. Pure: the traffic sim and the cab both use this, so a replay stops cars at the same arms.
   One gate for the driver's direction. The first is 50 m after the pinned GULP (landmarks nearStart, s = 80). */

export const TOLL_FIRST = 130;
export const TOLL_EVERY = 8000;
export const TOLL_WAIT = 4;   // s an AI car sits at the arm before it is let through

/** the next gate strictly ahead of s (a car exactly on the gate has passed it) */
export function nextToll(s) {
  if (s < TOLL_FIRST) return TOLL_FIRST;
  return TOLL_FIRST + (Math.floor((s - TOLL_FIRST) / TOLL_EVERY) + 1) * TOLL_EVERY;
}

/** gates with s0 <= gate < s1 */
export function tollsBetween(s0, s1) {
  const out = [];
  let g = s0 <= TOLL_FIRST ? TOLL_FIRST : TOLL_FIRST + Math.ceil((s0 - TOLL_FIRST) / TOLL_EVERY) * TOLL_EVERY;
  for (; g < s1; g += TOLL_EVERY) if (g >= s0) out.push(g);
  return out;
}
