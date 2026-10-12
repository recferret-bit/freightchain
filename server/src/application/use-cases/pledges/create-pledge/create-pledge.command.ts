export class CreatePledgeCommand {
  constructor(
    public readonly sponsor: string,
    public readonly rideId: string,
    public readonly lamportsPerKm: bigint,
    public readonly targetKm: number,
  ) {}
}
