import { weekBounds } from './week.js';
import { splitPool } from './prize-split.js';

export enum RoundStatus {
  Open = 'open',
  Closed = 'closed',
}

export interface RoundProps {
  /** null until the database assigns it */
  id: number | null;
  startsAt: Date;
  endsAt: Date;
  /** lamports seeded in from the previous round (its 20 % "next ride start") */
  carry: number;
  status: RoundStatus;
}

/** ONE global weekly prize round (UTC Monday → Monday): every paid entry feeds the same pool. Accounting only – settlement / payouts not built. */
export class Round {
  private constructor(private readonly p: RoundProps) {}

  /** The round of the week containing `now`, seeded with `carry`. */
  static open(now: Date, carry: number): Round {
    const { start, end } = weekBounds(now);
    return new Round({ id: null, startsAt: start, endsAt: end, carry, status: RoundStatus.Open });
  }

  static restore(props: RoundProps): Round {
    return new Round({ ...props });
  }

  get id(): number {
    if (this.p.id === null) throw new Error('round is not persisted yet');
    return this.p.id;
  }
  get startsAt(): Date { return this.p.startsAt; }
  get endsAt(): Date { return this.p.endsAt; }
  get carry(): number { return this.p.carry; }
  get status(): RoundStatus { return this.p.status; }

  contains(at: Date): boolean {
    return this.p.startsAt.getTime() <= at.getTime() && at.getTime() < this.p.endsAt.getTime();
  }

  /** What this round hands to the next one: its 20 % – plus its own carry if nobody entered (an empty week passes the seed on). */
  carryOver(entriesLamports: number, entryCount: number): number {
    return splitPool(entriesLamports).nextSeed + (entryCount === 0 ? this.p.carry : 0);
  }

  close(): void {
    this.p.status = RoundStatus.Closed;
  }

  snapshot(): RoundProps {
    return { ...this.p };
  }
}
