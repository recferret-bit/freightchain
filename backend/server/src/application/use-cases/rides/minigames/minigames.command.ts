/** `mac` is required and 43 base64url chars. Real HMAC waits for the session key; a mac of that shape is not rejected. */
export class OpenMinigameCommand {
  constructor(
    public readonly wallet: string,
    public readonly rideId: string,
    public readonly eventId: string,
    public readonly mac: string,
    public readonly variantSeq: 0 | 1,
    public readonly safe: boolean | null,
  ) {}
}

export class AnswerMinigameCommand {
  constructor(
    public readonly wallet: string,
    public readonly rideId: string,
    public readonly eventId: string,
    public readonly mac: string,
    public readonly nonce: string,
    public readonly attempt: number,
    public readonly answer: string,
    public readonly safe: boolean | null,
  ) {}
}

export class GetMinigameAssetQuery {
  constructor(
    public readonly wallet: string,
    public readonly rideId: string,
    public readonly eventId: string,
    public readonly assetId: string,
  ) {}
}
