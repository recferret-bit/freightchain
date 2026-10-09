/* Historical dispatch prompts. Rules v4 no longer issues them or judges the answers. Rows from before still round-trip:
   parseChallenges validates the JSON the ride stored ([{ id, action, issuedMs, deadlineMs }]). */

export type ChallengeAction = 'headlights' | 'wipers' | 'cab' | 'washer';

/** the four cab actions a stored prompt may name */
const ACTIONS: readonly ChallengeAction[] = ['headlights', 'wipers', 'cab', 'washer'];

/** One prompt as an old ride stores it. Times are milliseconds since the ride STARTED. */
export interface RideChallenge {
  id: string;
  action: ChallengeAction;
  issuedMs: number;
  deadlineMs: number;
}

/** The wire view. Heartbeats always send null now; the field stays so a client still parses it. */
export interface ChallengeDto {
  id: string;
  action: ChallengeAction;
  label: string;
  key: string;
  codes: string[];
  issuedMs: number;
  deadlineMs: number;
}

/** The stored JSON of a ride's prompts, validated (a row is never trusted blindly). */
export function parseChallenges(raw: unknown): RideChallenge[] {
  if (!Array.isArray(raw)) return [];
  const out: RideChallenge[] = [];
  for (const c of raw) {
    if (typeof c !== 'object' || c === null) continue;
    const { id, action, issuedMs, deadlineMs } = c as Record<string, unknown>;
    if (typeof id !== 'string' || typeof action !== 'string' || typeof issuedMs !== 'number' || typeof deadlineMs !== 'number') continue;
    if (!ACTIONS.includes(action as ChallengeAction)) continue;
    out.push({ id, action: action as ChallengeAction, issuedMs, deadlineMs });
  }
  return out;
}
