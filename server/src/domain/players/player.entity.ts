import { ConflictError } from '../shared/errors.js';
import { utcDay } from '../shared/time.js';

export interface PlayerProps {
  wallet: string;
  version: number;
  freeRides: number;
  freeDay: string;
  createdAt: Date;
}

/** A rider, identified by the Solana wallet that signed in. Owns the free-ride credits. */
export class Player {
  private constructor(private readonly props: PlayerProps) {}

  /** First sight of a wallet: the signup free rides. */
  static register(wallet: string, now: Date, freeOnSignup: number): Player {
    return new Player({ wallet, version: 1, freeRides: freeOnSignup, freeDay: utcDay(now), createdAt: now });
  }

  static restore(props: PlayerProps): Player {
    return new Player({ ...props });
  }

  get wallet(): string { return this.props.wallet; }
  get version(): number { return this.props.version; }
  get freeRides(): number { return this.props.freeRides; }
  get freeDay(): string { return this.props.freeDay; }
  get createdAt(): Date { return this.props.createdAt; }

  /** +1 free ride once per UTC day, no backlog (a rider away for a week still gets one). Returns whether a credit was granted. */
  applyDailyGrant(now: Date): boolean {
    const today = utcDay(now);
    if (this.props.freeDay >= today) return false;
    this.props.freeRides += 1;
    this.props.freeDay = today;
    return true;
  }

  spendFreeRide(): void {
    if (this.props.freeRides <= 0) throw new ConflictError('no free rides left');
    this.props.freeRides -= 1;
  }

  /** A credit comes back when the unstarted free ride it paid for is cancelled. */
  refundFreeRide(): void {
    this.props.freeRides += 1;
  }

  snapshot(): PlayerProps {
    return { ...this.props };
  }
}
