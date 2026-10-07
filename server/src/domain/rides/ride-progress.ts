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

/** min(time credit, distance credit). Either axis alone cannot finish a shift, so neither alone is a milestone. */
export function progressRatio(driveSeconds: number, minSeconds: number, distance: number, completeDist: number): number {
  if (minSeconds <= 0 || completeDist <= 0) return 0;
  return Math.min(driveSeconds / minSeconds, distance / completeDist);
}
