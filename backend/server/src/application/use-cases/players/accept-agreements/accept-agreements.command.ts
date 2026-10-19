/** The two profile boxes. Both booleans are the whole state: the last write wins, a box left out is not "keep the old one". */
export class AcceptAgreementsCommand {
  constructor(
    public readonly wallet: string,
    public readonly age18: boolean,
    public readonly loss: boolean,
  ) {}
}
