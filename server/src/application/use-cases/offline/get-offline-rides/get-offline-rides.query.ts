export class GetOfflineRidesQuery {
  constructor(
    public readonly wallet: string | null,
    public readonly fingerprint: string,
    public readonly ip: string | null,
  ) {}
}
