import type { EffectId } from '../../../../domain/live/live-rules.js';

/** A spectator posts into a running ride's feed: a chat line, or a (mock) donation with an effect and an optional note. */
export type RideEventInput = { kind: 'message'; text: string; replayT?: number } | { kind: 'donation'; effect: EffectId; note: string | null; lamports?: number | null };

export class PostRideEventCommand {
  constructor(
    public readonly wallet: string,
    public readonly rideId: string,
    public readonly input: RideEventInput,
  ) {}
}
