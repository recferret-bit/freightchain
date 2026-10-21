export class ListAdminActionsQuery {
  constructor(public readonly limit: number, public readonly actor: string | null = null) {}
}
