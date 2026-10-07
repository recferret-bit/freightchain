export class RejudgeRideCommand {
  constructor(
    public readonly admin: string,
    public readonly rideId: string,
    public readonly requestId: string | null,
  ) {}
}
