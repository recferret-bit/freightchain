import type { AuthChallenge } from '../../../src/domain/auth/auth-challenge.entity.js';
import type { AchievementUnlock } from '../../../src/domain/achievements/achievement-unlock.entity.js';
import type { Payment } from '../../../src/domain/economy/payment.entity.js';
import type { RoundProps } from '../../../src/domain/economy/round.entity.js';
import type { PlayerProps } from '../../../src/domain/players/player.entity.js';
import type { RideProps } from '../../../src/domain/rides/ride.entity.js';
import type { PoolProps } from '../../../src/domain/economy/pool.types.js';
import type { PromoCodeProps } from '../../../src/domain/economy/promo.types.js';
import type { RideTicketProps, TicketGrantProps } from '../../../src/domain/players/ride-ticket.types.js';

/** The whole "database" of the in-memory suite: plain maps of snapshots (repositories hand out fresh entities, like real rows). */
export class MemoryDb {
  players = new Map<string, PlayerProps>();
  challenges = new Map<string, AuthChallenge>();
  rides = new Map<string, { props: RideProps; seq: number }>();
  rounds: RoundProps[] = [];
  payments: Payment[] = [];
  unlocks: AchievementUnlock[] = [];
  pools = new Map<number, PoolProps>();
  /** key `${wallet}|${poolId}` */
  tickets = new Map<string, RideTicketProps>();
  grants: TicketGrantProps[] = [];
  promos = new Map<string, PromoCodeProps>();
  /** key `${code}|${wallet}|${n}` */
  redemptions = new Map<string, Date>();
  private seq = 0;
  private roundSeq = 0;

  nextSeq(): number { return ++this.seq; }
  nextRoundId(): number { return ++this.roundSeq; }

  reset(): void {
    this.players.clear(); this.challenges.clear(); this.rides.clear();
    this.rounds = []; this.payments = []; this.unlocks = [];
    this.seq = 0; this.roundSeq = 0;
    this.pools.clear(); this.tickets.clear(); this.grants = []; this.promos.clear(); this.redemptions.clear();
  }
}
