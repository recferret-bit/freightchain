export class SubmitRideAppealCommand {
  constructor(public readonly wallet: string, public readonly rideId: string, public readonly reason: string) {}
}

export class ListRideAppealsQuery {
  constructor(public readonly poolId?: number) {}
}

export class ResolveRideAppealCommand {
  constructor(
    public readonly admin: string,
    public readonly appealId: string,
    public readonly decision: 'upheld' | 'denied',
    public readonly note: string | null,
    public readonly signature: string,
  ) {}
}

export interface RideAppealDto {
  id: string;
  rideId: string;
  poolId: number;
  wallet: string;
  status: 'open' | 'upheld' | 'denied';
  reason: string;
  createdAt: number;
  resolvedAt: number | null;
}
