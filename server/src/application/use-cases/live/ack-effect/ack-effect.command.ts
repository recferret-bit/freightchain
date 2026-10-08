/** The driver's game applied a spectator's effect: at game time `t`, at road position `s` (an obstacle: where it was put) and `lat` across the road. */
export class AckEffectCommand {
  constructor(
    public readonly wallet: string,
    public readonly rideId: string,
    public readonly eventId: number,
    public readonly report: { t: number; s: number; lat: number | null },
  ) {}
}
