/** The driver's game applied a spectator's effect: at game time `t`, at road position `s` (an obstacle: where it was put) and `lat` across the road;
    `missed` = an obstacle it found no room for (stamped so spectators stop waiting for it). */
export class AckEffectCommand {
  constructor(
    public readonly wallet: string,
    public readonly rideId: string,
    public readonly eventId: number,
    public readonly report: { t: number; s: number; lat: number | null; missed?: boolean },
  ) {}
}
