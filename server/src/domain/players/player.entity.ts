import { ConflictError } from '../shared/errors.js';
import { utcDay } from '../shared/time.js';

export interface PlayerProps {
  wallet: string;
  version: number;
  freeRides: number;
  freeDay: string;
  /** the most free-ride credits the wallet can hold – the daily grant stops here (column default 5) */
  freeRidesMax: number;
  createdAt: Date;
  /** when a ride was first STARTED with the tutorial on (null = never): the lobby then leaves the tutorial off by default */
  tutorialPassedAt: Date | null;
}

/** A rider, identified by the Solana wallet that signed in. Owns the free-ride credits. */
export class Player {
  /** Set after `insertIfAbsent` resolves. Not in `snapshot()`, so a later save cannot write it. */
  private fresh = false;

  private constructor(private readonly props: PlayerProps) {}

  /** First sight of a wallet: the signup free rides. */
  static register(wallet: string, now: Date, freeOnSignup: number, freeRidesMax: number): Player {
    return new Player({ wallet, version: 1, freeRides: freeOnSignup, freeDay: utcDay(now), freeRidesMax, createdAt: now, tutorialPassedAt: null });
  }

  static restore(props: PlayerProps): Player {
    return new Player({ ...props });
  }

  get wallet(): string { return this.props.wallet; }
  get version(): number { return this.props.version; }
  get freeRides(): number { return this.props.freeRides; }
  get freeDay(): string { return this.props.freeDay; }
  get freeRidesMax(): number { return this.props.freeRidesMax; }
  get createdAt(): Date { return this.props.createdAt; }
  get tutorialPassedAt(): Date | null { return this.props.tutorialPassedAt; }
  get tutorialPassed(): boolean { return this.props.tutorialPassedAt !== null; }
  /** True only when this process inserted the row on the touch that returned this instance. */
  get isNewPlayer(): boolean { return this.fresh; }

  markNewPlayer(isNew: boolean): void { this.fresh = isNew; }

  /** True when the next daily credit is still to come (below the cap) – the lobby counts down to it. */
  get awaitsDailyGrant(): boolean { return this.props.freeRides < this.props.freeRidesMax; }

  /**
   * +1 free ride once per UTC day, never above `freeRidesMax`, no backlog (a rider away for a week still gets one). The day is stamped even at the cap, so the
   * same rule as the midnight job (`grantDailyFreeRides`) applies. Returns whether anything changed (= the player must be saved). A balance already above the cap is left alone.
   */
  applyDailyGrant(now: Date): boolean {
    const today = utcDay(now);
    if (this.props.freeDay >= today) return false;
    if (this.awaitsDailyGrant) this.props.freeRides += 1;
    this.props.freeDay = today;
    return true;
  }

  /** Extra free rides from a promo code, on top of the daily ones. They may take the balance above `freeRidesMax`: the cap only limits the daily refill, which adds below it and never takes anything away. */
  grantFreeRides(count: number): void {
    if (!Number.isInteger(count) || count < 1) throw new Error('grantFreeRides needs a whole number ≥ 1');
    this.props.freeRides += count;
  }

  /** Starting a ride with the tutorial on counts as having done it – the first time only (the stamp never moves). Returns whether the player changed. */
  markTutorialPassed(now: Date): boolean {
    if (this.props.tutorialPassedAt) return false;
    this.props.tutorialPassedAt = now;
    return true;
  }

  spendFreeRide(): void {
    if (this.props.freeRides <= 0) throw new ConflictError('no free rides left');
    this.props.freeRides -= 1;
  }

  /**
   * A credit comes back when the unstarted free ride it paid for is cancelled – but a wallet exactly at the cap stays there (the midnight job may have refilled the slot
   * meanwhile). A balance above the cap (legacy, from before the cap) still gets its credit back.
   */
  refundFreeRide(): void {
    if (this.props.freeRides !== this.props.freeRidesMax) this.props.freeRides += 1;
  }

  snapshot(): PlayerProps {
    return { ...this.props };
  }
}
