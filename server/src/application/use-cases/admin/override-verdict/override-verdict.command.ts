import type { VerdictDecision } from '../../../../domain/verdict/verdict.dto.js';

export class OverrideVerdictCommand {
  constructor(
    public readonly admin: string,
    public readonly rideId: string,
    public readonly decision: VerdictDecision,
    public readonly note: string | null,
    public readonly requestId: string | null,
  ) {}
}
