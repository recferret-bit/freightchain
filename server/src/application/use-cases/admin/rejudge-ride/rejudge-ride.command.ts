export class RejudgeRideCommand {
  constructor(
    public readonly admin: string,
    public readonly rideId: string,
    public readonly requestId: string | null,
    /** the admin wallet's signature over the text issued for re-judging exactly this ride */
    public readonly signature: string,
  ) {}
}
