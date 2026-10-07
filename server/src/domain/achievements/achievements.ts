/* The achievement catalogue and its rules – pure, so they are unit-tested and a later NFT mint can be based on each persisted unlock. */
export interface Facts {
  started: number; // rides that were actually started
  completed: number; // rides the server judged complete
  totalMetres: number; // distance over all started rides
  completedAtNight: boolean; // a completed shift with most of its drive time reported as night
  cleanRun: boolean; // completed with the hull at ~100 %
  completedSiberia: boolean;
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
  { id: 'top-20', name: 'Top 20', desc: 'Be in the top 20 when the weekly round closes.', icon: '★', rule: null }, // awarded at round close – settlement is not built yet
];

export const earnedIds = (f: Facts): string[] => ACHIEVEMENTS.filter((a) => a.rule?.(f)).map((a) => a.id);
