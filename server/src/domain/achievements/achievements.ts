/* The achievement catalogue and its rules – pure, so they are unit-tested and a later NFT mint can be based on each persisted unlock. */
export interface Facts {
  started: number; // rides that were actually started
  completed: number; // rides the server judged complete
  totalMetres: number; // distance over all started rides
  completedAtNight: boolean; // a completed shift with most of its drive time reported as night
  cleanRun: boolean; // completed with the hull at ~100 %
  completedSiberia: boolean;
  completedFreeUnassisted: boolean; // a FREE ride judged complete that was driven without ASSIST (the tutorial does not matter – it changes nothing in the truck)
  completedFreeLevels: number[]; // the free LEVELS (1 EASY · 2 MEDIUM · 3 HARD – ride-trip.ts FREE_LEVELS, from Ride.trip) with a ride judged complete
}

export interface Achievement {
  id: string;
  name: string;
  desc: string;
  icon: string;
  rule: ((f: Facts) => boolean) | null;
}

export const ACHIEVEMENTS: readonly Achievement[] = [
  { id: 'first-mile', name: 'First Mile', desc: 'Start your first ride.', icon: '⛟', rule: (f) => f.started >= 1 },
  { id: 'shift-complete', name: 'Shift Complete', desc: 'Finish a full shift: the time AND the distance.', icon: '✔', rule: (f) => f.completed >= 1 },
  { id: 'night-owl', name: 'Night Owl', desc: 'Finish a shift driven mostly in the dark.', icon: '☾', rule: (f) => f.completedAtNight },
  { id: 'century', name: 'Century', desc: 'Drive 100 km in total.', icon: '💯', rule: (f) => f.totalMetres >= 100_000 },
  { id: 'clean-run', name: 'Clean Run', desc: 'Finish a shift without a scratch (hull 100 %).', icon: '✦', rule: (f) => f.cleanRun },
  { id: 'cold-start', name: 'Cold Start', desc: 'Finish a shift on the Trans-Siberian route.', icon: '❄', rule: (f) => f.completedSiberia },
  { id: 'on-my-own', name: 'On My Own', desc: 'Complete a free ride without assist.', icon: '⚑', rule: (f) => f.completedFreeUnassisted },
  { id: 'free-easy', name: 'Learner’s Permit', desc: 'Clear the EASY free run.', icon: '①', rule: (f) => f.completedFreeLevels.includes(1) },
  { id: 'free-crossroads', name: 'Crossroads', desc: 'Clear the MEDIUM free run.', icon: '②', rule: (f) => f.completedFreeLevels.includes(2) },
  { id: 'free-hard', name: 'Long Haul', desc: 'Clear the HARD free run – fifteen minutes, no assist.', icon: '③', rule: (f) => f.completedFreeLevels.includes(3) },
  { id: 'top-20', name: 'Top 20', desc: 'Be in the top 20 when the weekly round closes.', icon: '★', rule: null }, // awarded at round close – settlement is not built yet
];

/** A ride whose recording the verdict REJECTED earns no badge while the verdict is enforced (VERDICT_ENFORCE=true; in shadow mode it changes nothing).
    A ride with no recording at all ('no-recording' its only reason) is not a cheat – it keeps counting. */
export const badgeRejected = (v: { status: string; reasons: unknown } | null | undefined): boolean =>
  v?.status === 'rejected' && !(Array.isArray(v.reasons) && v.reasons.length > 0 && v.reasons.every((r) => (r as { code?: unknown })?.code === 'no-recording'));

export const earnedIds = (f: Facts): string[] => ACHIEVEMENTS.filter((a) => a.rule?.(f)).map((a) => a.id);
