export class ListSignInsQuery {
  constructor(
    public readonly limit: number,
    public readonly wallet?: string,
  ) {}
}
