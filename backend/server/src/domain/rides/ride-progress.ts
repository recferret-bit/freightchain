export type ProgressMilestone = 25 | 50 | 75;

const BANDS = [0.25, 0.5, 0.75] as const;

/** Bands the ratio crossed, strictly from below. There is no milestone 100. */
export function progressMilestones(before: number, after: number): ProgressMilestone[] {
  const out: ProgressMilestone[] = [];
  for (const band of BANDS) {
    if (before < band && after >= band) out.push((band * 100) as ProgressMilestone);
  }
  return out;
}

/** The share of the finish line covered – the line is the whole condition of a complete shift. */
export function progressRatio(distance: number, completeDist: number): number {
  if (completeDist <= 0) return 0;
  return distance / completeDist;
}
