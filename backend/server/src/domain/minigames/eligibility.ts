/** 1h paid/pool rides only. Free, tutorial, and assist (training) get no events and a null commit. */
export function minigamesEligible(ride: { tier: string; tutorial: boolean; assist: boolean }): boolean {
  return ride.tier === '1h' && !ride.tutorial && !ride.assist;
}
