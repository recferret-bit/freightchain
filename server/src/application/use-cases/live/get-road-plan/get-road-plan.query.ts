/** A stretch [from, to) m of a ride's obstacle plan – the holes the server rebuilt from the ride's seed (domain/road/road-plan.ts). */
export class GetRoadPlanQuery {
  constructor(
    public readonly rideId: string,
    public readonly from: number,
    public readonly to: number,
  ) {}
}
