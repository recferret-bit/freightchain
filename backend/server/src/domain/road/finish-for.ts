import { FINISH_RULES_VERSION, finishBlocked, finishFor as finishForShared, snapSafe as snapSafeShared } from '../shared/index.js';

export { FINISH_RULES_VERSION };

export interface FinishForResult {
  finishS: number;
  expectedSeconds: number;
  finishRulesVersion: number;
  rx: number;
  rz: number;
  rt: number;
}

/** Same function the client imports. A full-length 1h ride stores `finishS` as `completeDist`. */
export function finishFor(roadSeed: number, trip: string | null, finishRulesVersion: number = FINISH_RULES_VERSION): FinishForResult {
  return finishForShared(roadSeed, trip ?? 'classic', finishRulesVersion);
}

export function finishIsBlocked(roadSeed: number, trip: string | null, s: number): boolean {
  return finishBlocked(roadSeed, trip ?? 'classic', s);
}

export const snapSafe = snapSafeShared;
