/** A signed admin change of one wallet's free-ride balance (`AdminIntent` free_rides_adjust). */
export class AdjustFreeRidesCommand {
  constructor(
    public readonly admin: string,
    public readonly wallet: string,
    public readonly delta: number,
    public readonly requestId: string | null,
    public readonly signature: string,
  ) {}
}

export interface FreeRidesAdjustedDto {
  wallet: string;
  delta: number;
  freeRides: number;
  freeRidesMax: number;
}
