export class GetAdminStatsQuery {
  constructor(
    public readonly days: number,
    public readonly top: number,
  ) {}
}
