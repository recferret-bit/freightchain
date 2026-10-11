/* The achievement catalogue and its rules – pure (and import-free, so design/achievements/generate.mjs reads it as is). Each family is a ladder of 3-4 tiers, easy to
   hard; each tier is one achievement and, once earned and minted, one soulbound compressed NFT (docs/agents/achievements.md). Tier 1 keeps the id the family had before
   the tiers existed – unlock rows in production reference those ids, so an id is FROZEN once a wallet could have earned it. A new tier = a new id. */
export interface Facts {
  started: number; // rides that were actually started
  completed: number; // rides the server judged complete
  totalMetres: number; // distance over all started rides
  nightShifts: number; // completed shifts with most of their drive time reported as night
  cleanRuns: number; // completed shifts with the hull at ~100 %
  siberiaShifts: number; // completed shifts on the Trans-Siberian route
  freeUnassisted: number; // FREE rides judged complete that were driven without ASSIST (the tutorial does not matter – it changes nothing in the truck)
  completedFreeLevels: number[]; // the free LEVELS (1 EASY · 2 MEDIUM · 3 HARD – ride-trip.ts FREE_LEVELS, from Ride.trip) with a ride judged complete
}

export type AchievementFamily = 'road' | 'shift' | 'night' | 'distance' | 'clean' | 'siberia' | 'solo' | 'licence' | 'podium';

export interface Achievement {
  id: string;
  family: AchievementFamily;
  /** 1 = Bronze … 4 = Platinum */
  tier: number;
  name: string; // ≤ 32 characters: it is the cNFT's on-chain name
  desc: string;
  icon: string;
  /** the number the rule reads; null = awarded by an event, not by rides (the round / pool podium, not built yet) */
  measure: ((f: Facts) => number) | null;
  /** earned when measure(facts) >= target */
  target: number;
}

export const TIER_NAMES = ['Bronze', 'Silver', 'Gold', 'Platinum'] as const;
export const FAMILY_NAMES: Record<AchievementFamily, string> = {
  road: 'Road', shift: 'Shifts', night: 'Night', distance: 'Distance', clean: 'Clean', siberia: 'Siberia', solo: 'Solo', licence: 'Licence', podium: 'Podium',
};

const km = (f: Facts) => f.totalMetres / 1000;
const level = (n: number) => (f: Facts) => (f.completedFreeLevels.includes(n) ? 1 : 0);

export const ACHIEVEMENTS: readonly Achievement[] = [
  { id: 'first-mile', family: 'road', tier: 1, name: 'First Mile', desc: 'Start your first ride.', icon: '⛟', measure: (f) => f.started, target: 1 },
  { id: 'first-mile-2', family: 'road', tier: 2, name: 'Regular Hauler', desc: 'Start 10 rides.', icon: '⛟', measure: (f) => f.started, target: 10 },
  { id: 'first-mile-3', family: 'road', tier: 3, name: 'Road Dog', desc: 'Start 50 rides.', icon: '⛟', measure: (f) => f.started, target: 50 },
  { id: 'first-mile-4', family: 'road', tier: 4, name: 'Asphalt Legend', desc: 'Start 250 rides.', icon: '⛟', measure: (f) => f.started, target: 250 },

  { id: 'shift-complete', family: 'shift', tier: 1, name: 'Shift Complete', desc: 'Finish a full shift: the time AND the distance.', icon: '✔', measure: (f) => f.completed, target: 1 },
  { id: 'shift-complete-2', family: 'shift', tier: 2, name: 'Shift Worker', desc: 'Finish 5 shifts.', icon: '✔', measure: (f) => f.completed, target: 5 },
  { id: 'shift-complete-3', family: 'shift', tier: 3, name: 'Company Driver', desc: 'Finish 25 shifts.', icon: '✔', measure: (f) => f.completed, target: 25 },
  { id: 'shift-complete-4', family: 'shift', tier: 4, name: 'Cargo Captain', desc: 'Finish 100 shifts.', icon: '✔', measure: (f) => f.completed, target: 100 },

  { id: 'night-owl', family: 'night', tier: 1, name: 'Night Owl', desc: 'Finish a shift driven mostly in the dark.', icon: '☾', measure: (f) => f.nightShifts, target: 1 },
  { id: 'night-owl-2', family: 'night', tier: 2, name: 'Moonlighter', desc: 'Finish 5 shifts driven mostly in the dark.', icon: '☾', measure: (f) => f.nightShifts, target: 5 },
  { id: 'night-owl-3', family: 'night', tier: 3, name: 'Graveyard Shift', desc: 'Finish 20 shifts driven mostly in the dark.', icon: '☾', measure: (f) => f.nightShifts, target: 20 },
  { id: 'night-owl-4', family: 'night', tier: 4, name: 'Lord of the Dark', desc: 'Finish 50 shifts driven mostly in the dark.', icon: '☾', measure: (f) => f.nightShifts, target: 50 },

  { id: 'century', family: 'distance', tier: 1, name: 'Century', desc: 'Drive 100 km in total.', icon: '💯', measure: km, target: 100 },
  { id: 'century-2', family: 'distance', tier: 2, name: 'Five Hundred Club', desc: 'Drive 500 km in total.', icon: '💯', measure: km, target: 500 },
  { id: 'century-3', family: 'distance', tier: 3, name: 'Cross-Continental', desc: 'Drive 2,000 km in total.', icon: '💯', measure: km, target: 2_000 },
  { id: 'century-4', family: 'distance', tier: 4, name: 'Odometer Legend', desc: 'Drive 10,000 km in total.', icon: '💯', measure: km, target: 10_000 },

  { id: 'clean-run', family: 'clean', tier: 1, name: 'Clean Run', desc: 'Finish a shift without a scratch (hull 100 %).', icon: '✦', measure: (f) => f.cleanRuns, target: 1 },
  { id: 'clean-run-2', family: 'clean', tier: 2, name: 'Spotless', desc: 'Finish 5 shifts without a scratch.', icon: '✦', measure: (f) => f.cleanRuns, target: 5 },
  { id: 'clean-run-3', family: 'clean', tier: 3, name: 'Untouchable', desc: 'Finish 20 shifts without a scratch.', icon: '✦', measure: (f) => f.cleanRuns, target: 20 },
  { id: 'clean-run-4', family: 'clean', tier: 4, name: 'Mirror Finish', desc: 'Finish 50 shifts without a scratch.', icon: '✦', measure: (f) => f.cleanRuns, target: 50 },

  { id: 'cold-start', family: 'siberia', tier: 1, name: 'Cold Start', desc: 'Finish a shift on the Trans-Siberian route.', icon: '❄', measure: (f) => f.siberiaShifts, target: 1 },
  { id: 'cold-start-2', family: 'siberia', tier: 2, name: 'Permafrost Hauler', desc: 'Finish 5 shifts on the Trans-Siberian route.', icon: '❄', measure: (f) => f.siberiaShifts, target: 5 },
  { id: 'cold-start-3', family: 'siberia', tier: 3, name: 'Ice Road King', desc: 'Finish 15 shifts on the Trans-Siberian route.', icon: '❄', measure: (f) => f.siberiaShifts, target: 15 },
  { id: 'cold-start-4', family: 'siberia', tier: 4, name: 'Siberian Legend', desc: 'Finish 40 shifts on the Trans-Siberian route.', icon: '❄', measure: (f) => f.siberiaShifts, target: 40 },

  { id: 'on-my-own', family: 'solo', tier: 1, name: 'On My Own', desc: 'Complete a free ride without assist.', icon: '⚑', measure: (f) => f.freeUnassisted, target: 1 },
  { id: 'on-my-own-2', family: 'solo', tier: 2, name: 'No Training Wheels', desc: 'Complete 5 free rides without assist.', icon: '⚑', measure: (f) => f.freeUnassisted, target: 5 },
  { id: 'on-my-own-3', family: 'solo', tier: 3, name: 'Hands of Steel', desc: 'Complete 20 free rides without assist.', icon: '⚑', measure: (f) => f.freeUnassisted, target: 20 },
  { id: 'on-my-own-4', family: 'solo', tier: 4, name: 'Pure Driver', desc: 'Complete 50 free rides without assist.', icon: '⚑', measure: (f) => f.freeUnassisted, target: 50 },

  { id: 'free-easy', family: 'licence', tier: 1, name: 'Learner’s Permit', desc: 'Clear the EASY free run.', icon: '①', measure: level(1), target: 1 },
  { id: 'free-crossroads', family: 'licence', tier: 2, name: 'Crossroads', desc: 'Clear the MEDIUM free run.', icon: '②', measure: level(2), target: 1 },
  { id: 'free-hard', family: 'licence', tier: 3, name: 'Long Haul', desc: 'Clear the HARD free run – fifteen minutes, no assist.', icon: '③', measure: level(3), target: 1 },

  // awarded at round / pool close – settlement is not built for badges yet; never minted, never counted
  { id: 'top-20', family: 'podium', tier: 1, name: 'Top 20', desc: 'Be in the top 20 when the weekly round closes.', icon: '★', measure: null, target: 1 },
];

/** A ride whose recording the verdict REJECTED earns no badge while the verdict is enforced (VERDICT_ENFORCE=true; in shadow mode it changes nothing).
    A ride with no recording at all ('no-recording' its only reason) is not a cheat – it keeps counting. */
export const badgeRejected = (v: { status: string; reasons: unknown } | null | undefined): boolean =>
  v?.status === 'rejected' && !(Array.isArray(v.reasons) && v.reasons.length > 0 && v.reasons.every((r) => (r as { code?: unknown })?.code === 'no-recording'));

export const ACHIEVEMENT_BY_ID: ReadonlyMap<string, Achievement> = new Map(ACHIEVEMENTS.map((a) => [a.id, a]));

/** how far along a wallet is: `value` is clamped to the target, `done` is the rule */
export const progressOf = (a: Achievement, f: Facts): { value: number; target: number; done: boolean } => {
  const raw = a.measure ? a.measure(f) : 0;
  return { value: Math.min(Math.floor(raw), a.target), target: a.target, done: a.measure !== null && raw >= a.target };
};

export const earnedIds = (f: Facts): string[] => ACHIEVEMENTS.filter((a) => progressOf(a, f).done).map((a) => a.id);
