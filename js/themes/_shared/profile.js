/* First ~60 m of every route are dead straight, then the curves ease in over 120 m (so the start of a ride is always calm). */
export const ramp = s => Math.min(1, Math.max(0, (s - 60) / 120));
