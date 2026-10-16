import type { AchievementMintRecord } from '../../../src/domain/achievements/achievement-mint.js';
import type { AuthChallenge } from '../../../src/domain/auth/auth-challenge.entity.js';
import type { AchievementUnlock } from '../../../src/domain/achievements/achievement-unlock.entity.js';
import type { Payment } from '../../../src/domain/economy/payment.entity.js';
import type { RoundProps } from '../../../src/domain/economy/round.entity.js';
import type { PlayerProps } from '../../../src/domain/players/player.entity.js';
import type { RideProps } from '../../../src/domain/rides/ride.entity.js';
import type { PoolProps } from '../../../src/domain/economy/pool.types.js';
import type { PromoCodeProps } from '../../../src/domain/economy/promo.types.js';
import type { CosmeticUnlockRecord } from '../../../src/application/ports/players/cosmetic.repository.port.js';
import type { TicketOrderProps } from '../../../src/domain/economy/ticket-order.types.js';
import type { RideTicketProps, TicketGrantProps } from '../../../src/domain/players/ride-ticket.types.js';
import type { ChainEventRow } from '../../../src/domain/economy/chain-events.js';
import type { ChainCursorRow } from '../../../src/application/ports/economy/chain-event.repository.port.js';
import type { RideBatchProps } from '../../../src/domain/telemetry/ride-batch.entity.js';
import type { RideVerdictProps } from '../../../src/domain/verdict/ride-verdict.entity.js';
import type { RideReplayProps } from '../../../src/domain/verdict/ride-replay.entity.js';
import type { SignInRecord } from '../../../src/domain/auth/sign-in.js';
import type { AdminActionRecord } from '../../../src/domain/admin/admin.dto.js';
import type { RideEventProps } from '../../../src/domain/live/ride-event.entity.js';
import type { StatsRow } from '../../../src/application/ports/stats/stats.repository.port.js';
import type { DonationOrderProps } from '../../../src/domain/live/donation-order.entity.js';
import type { HonkAccountRow, HonkBurnRow, HonkMintRow, HonkVisualRow } from '../../../src/application/ports/honk/honk.repository.port.js';

/** The whole "database" of the in-memory suite: plain maps of snapshots (repositories hand out fresh entities, like real rows). */
export class MemoryDb {
  players = new Map<string, PlayerProps>();
  challenges = new Map<string, AuthChallenge>();
  rides = new Map<string, { props: RideProps; seq: number }>();
  rounds: RoundProps[] = [];
  payments: Payment[] = [];
  unlocks: AchievementUnlock[] = [];
  mints: AchievementMintRecord[] = [];
  pools = new Map<number, PoolProps>();
  /** the payout ledger, key `${poolId}|${rank}` */
  poolPayouts = new Map<string, import('../../../src/domain/economy/pool-payout.js').PoolPayoutRecord>();
  /** key `${wallet}|${poolId}` */
  tickets = new Map<string, RideTicketProps>();
  grants: TicketGrantProps[] = [];
  promos = new Map<string, PromoCodeProps>();
  /** key `${code}|${wallet}|${n}` */
  redemptions = new Map<string, Date>();
  orders = new Map<string, TicketOrderProps>();
  /** key `${wallet}|${slot}|${item}` */
  cosmeticUnlocks = new Map<string, CosmeticUnlockRecord>();
  /** key `${wallet}|${slot}` → item */
  cosmeticEquipped = new Map<string, string>();
  chainEvents: ChainEventRow[] = [];
  chainCursors = new Map<string, ChainCursorRow>();
  /** key = `${rideId}:${seq}` */
  batches = new Map<string, RideBatchProps>();
  verdicts = new Map<string, RideVerdictProps>();
  replays = new Map<string, RideReplayProps>();
  signIns: SignInRecord[] = [];
  adminActions: AdminActionRecord[] = [];
  /** live feed, in id order */
  rideEvents: RideEventProps[] = [];
  /** `${rideId}|${wallet}` */
  rideMutes = new Set<string>();
  donationOrders = new Map<string, DonationOrderProps>();
  /** statistics: one row per rider + the global row */
  playerStats = new Map<string, StatsRow>();
  globalStats: StatsRow | null = null;
  /** UTC day → totals */
  dailyStats = new Map<string, import('../../../src/domain/stats/stats.js').StatsTotals>();
  /** `player.GameSetting` */
  settings = new Map<string, number>();
  /** `${tier}|${day}` → the day's road seed of a paid tier (ride.DailySeed) */
  dailySeeds = new Map<string, number>();
  pledges = new Map<string, import('../../../src/domain/economy/pledge.types.js').PledgeProps>();
  honkMints = new Map<string, HonkMintRow>();
  honkAccounts = new Map<string, HonkAccountRow & { updatedAt: Date }>();
  honkBurns = new Map<string, HonkBurnRow>();
  honkVisuals = new Map<string, HonkVisualRow>();
  honkEmission = 0n;
  private seq = 0;
  private roundSeq = 0;

  nextSeq(): number { return ++this.seq; }
  nextRoundId(): number { return ++this.roundSeq; }

  /** asset.Entity / asset.EntityRevision (the 3D model editor's history) */
  entities = new Map<string, import('../../../src/domain/entities/entity.js').EntityRecord & { publishedAt: Date | null }>();
  entityRevisions: import('../../../src/domain/entities/entity.js').RevisionRecord[] = [];
  /** asset.EditorJob prompts by job id (the revision list shows them) */
  editorJobPrompts = new Map<string, string>();
  editorJobs = new Map<string, import('../../../src/domain/editor/editor-job.js').EditorJobRecord>();
  editorJobEvents = new Map<string, import('../../../src/domain/editor/editor-job.js').JobEventRecord[]>();

  reset(): void {
    this.players.clear(); this.challenges.clear(); this.rides.clear(); this.batches.clear(); this.verdicts.clear(); this.replays.clear();
    this.rounds = []; this.payments = []; this.unlocks = []; this.mints = []; this.signIns = []; this.adminActions = [];
    this.seq = 0; this.roundSeq = 0;
    this.pools.clear(); this.tickets.clear(); this.grants = []; this.promos.clear(); this.redemptions.clear(); this.orders.clear(); this.cosmeticUnlocks.clear(); this.cosmeticEquipped.clear();
    this.chainEvents = []; this.chainCursors.clear();
    this.rideEvents = []; this.rideMutes.clear(); this.donationOrders.clear(); this.playerStats.clear(); this.globalStats = null; this.dailyStats.clear();
    this.settings.clear(); this.dailySeeds.clear(); this.pledges.clear();
    this.honkMints.clear(); this.honkAccounts.clear(); this.honkBurns.clear(); this.honkVisuals.clear(); this.honkEmission = 0n;
    this.entities.clear(); this.entityRevisions = []; this.editorJobPrompts.clear(); this.editorJobs.clear(); this.editorJobEvents.clear();
  }
}
