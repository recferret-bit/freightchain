import type { TraceFlag } from '../../domain/anticheat/trace-cluster.js';
import type { RideVerdictRepositoryPort } from '../ports/verdict/ride-verdict.repository.port.js';

/** A similar pair in the top 20 is flagged for admin review. An overridden verdict is left as the admin set it. */
export async function flagClusteredRides(verdicts: RideVerdictRepositoryPort, flags: readonly TraceFlag[]): Promise<string[]> {
  const ids = [...new Set(flags.flatMap((flag) => [flag.rideId, flag.otherRideId]))];
  const flagged: string[] = [];
  for (const rideId of ids) {
    const verdict = await verdicts.findByRide(rideId);
    if (!verdict || verdict.isOverridden) continue;
    if (!verdict.addReasons([{ code: 'trace-cluster', detail: 'similar inp among the top 20', severity: 'flag' }])) continue;
    await verdicts.save(verdict);
    flagged.push(rideId);
  }
  return flagged;
}
