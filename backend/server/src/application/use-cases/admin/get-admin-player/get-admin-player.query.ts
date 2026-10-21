export class GetAdminPlayerQuery {
  constructor(public readonly wallet: string, public readonly actor: string | null = null) {}
}
