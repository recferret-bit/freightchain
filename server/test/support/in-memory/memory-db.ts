import type { AuthChallenge } from '../../../src/domain/auth/auth-challenge.entity.js';
import type { AchievementUnlock } from '../../../src/domain/achievements/achievement-unlock.entity.js';
import type { Payment } from '../../../src/domain/economy/payment.entity.js';
import type { RoundProps } from '../../../src/domain/economy/round.entity.js';
import type { PlayerProps } from '../../../src/domain/players/player.entity.js';
import type { RideProps } from '../../../src/domain/rides/ride.entity.js';
import type { PoolProps } from '../../../src/domain/economy/pool.types.js';
import type { PromoCodeProps } from '../../../src/domain/economy/promo.types.js';
import type { TicketOrderProps } from '../../../src/domain/economy/ticket-order.types.js';
import type { RideTicketProps, TicketGrantProps } from '../../../src/domain/players/ride-ticket.types.js';
import type { ChainEventRow } from '../../../src/domain/economy/chain-events.js';
import type { ChainCursorRow } from '../../../src/application/ports/economy/chain-event.repository.port.js';
import type { SponsoredTxRow } from '../../../src/application/ports/economy/sponsored-tx.repository.port.js';
import type { RideBatchProps } from '../../../src/domain/telemetry/ride-batch.entity.js';
import type { RideVerdictProps } from '../../../src/domain/verdict/ride-verdict.entity.js';
import type { SignInRecord } from '../../../src/domain/auth/sign-in.js';
import type { AdminActionRecord } from '../../../src/domain/admin/admin.dto.js';
import type { RideEventProps } from '../../../src/domain/live/ride-event.entity.js';
import type { DonationOrderProps } from '../../../src/domain/live/donation-order.entity.js';

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
  orders = new Map<string, TicketOrderProps>();
  chainEvents: ChainEventRow[] = [];
  chainCursors = new Map<string, ChainCursorRow>();
  sponsoredTxs: SponsoredTxRow[] = [];
  /** key = `${rideId}:${seq}` */
  batches = new Map<string, RideBatchProps>();
  verdicts = new Map<string, RideVerdictProps>();
  signIns: SignInRecord[] = [];
  adminActions: AdminActionRecord[] = [];
  /** live feed, in id order */
  rideEvents: RideEventProps[] = [];
  /** `${rideId}|${wallet}` */
  rideMutes = new Set<string>();
  donationOrders = new Map<string, DonationOrderProps>();
  private seq = 0;
  private roundSeq = 0;

  nextSeq(): number { return ++this.seq; }
  nextRoundId(): number { return ++this.roundSeq; }

  reset(): void {
    this.players.clear(); this.challenges.clear(); this.rides.clear(); this.batches.clear(); this.verdicts.clear();
    this.rounds = []; this.payments = []; this.unlocks = []; this.signIns = []; this.adminActions = [];
    this.seq = 0; this.roundSeq = 0;
    this.pools.clear(); this.tickets.clear(); this.grants = []; this.promos.clear(); this.redemptions.clear(); this.orders.clear();
    this.chainEvents = []; this.chainCursors.clear(); this.sponsoredTxs = [];
    this.rideEvents = []; this.rideMutes.clear(); this.donationOrders.clear();
  }
}
