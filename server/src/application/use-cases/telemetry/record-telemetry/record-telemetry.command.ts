export interface TelemetryEventInput {
  event: string;
  properties?: unknown;
}

export interface TelemetryAckDto {
  enabled: boolean;
  accepted: number;
  dropped: number;
}

/** Anonymous-ok. `wallet` is the verified session, never a wallet named in the body. */
export class RecordTelemetryCommand {
  constructor(
    public readonly wallet: string | null,
    public readonly anonId: string | null,
    public readonly events: readonly TelemetryEventInput[],
  ) {}
}
