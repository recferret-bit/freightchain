import type { OfflineAllowance } from '../../../../domain/offline/offline-ride.js';

/** Spend one anonymous offline free ride, or refuse when the fingerprint or the address is already at its limit. */
export class ClaimOfflineRideCommand {
  constructor(
    public readonly wallet: string | null,
    public readonly fingerprint: string,
    public readonly ip: string | null,
  ) {}
}

export type OfflineRideDto = OfflineAllowance;
