/** The wallet's Garage: every part of the catalog with owned / worn, how it was earned, and the collection progress. */
export class GetGarageQuery {
  constructor(public readonly wallet: string) {}
}
