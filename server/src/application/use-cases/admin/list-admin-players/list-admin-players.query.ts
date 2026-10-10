export class ListAdminPlayersQuery {
  constructor(
    public readonly limit: number,
    public readonly q?: string,
  ) {}
}
