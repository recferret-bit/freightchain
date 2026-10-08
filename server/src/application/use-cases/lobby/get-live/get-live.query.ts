/** The public live feed. `visitor` / `page` = the polling page's random id and kind (landing | lobby) – it counts as online ('' = not counted);
    `source` = the client IP it is counted under; `wallet` = the signed-in wallet when the page sends the session cookie (null = anonymous). */
export class GetLiveQuery {
  constructor(
    public readonly visitor = '',
    public readonly page = '',
    public readonly source = '',
    public readonly wallet: string | null = null,
    /** the page is closing: it leaves the online count now */
    public readonly leave = false,
  ) {}
}
