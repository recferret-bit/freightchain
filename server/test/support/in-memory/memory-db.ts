import type { AuthChallenge } from '../../../src/domain/auth/auth-challenge.entity.js';
import type { AchievementUnlock } from '../../../src/domain/achievements/achievement-unlock.entity.js';
import type { Payment } from '../../../src/domain/economy/payment.entity.js';
import type { RoundProps } from '../../../src/domain/economy/round.entity.js';
import type { PlayerProps } from '../../../src/domain/players/player.entity.js';
import type { RideProps } from '../../../src/domain/rides/ride.entity.js';
import type { RideBatchProps } from '../../../src/domain/telemetry/ride-batch.entity.js';
import type { RideVerdictProps } from '../../../src/domain/verdict/ride-verdict.entity.js';
import type { SignInRecord } from '../../../src/domain/auth/sign-in.js';
import type { AdminActionRecord } from '../../../src/domain/admin/admin.dto.js';

/** The whole "database" of the in-memory suite: plain maps of snapshots (repositories hand out fresh entities, like real rows). */
export class MemoryDb {
  players = new Map<string, PlayerProps>();
  challenges = new Map<string, AuthChallenge>();
  rides = new Map<string, { props: RideProps; seq: number }>();
  rounds: RoundProps[] = [];
  payments: Payment[] = [];
  unlocks: AchievementUnlock[] = [];
  /** key = `${rideId}:${seq}` */
  batches = new Map<string, RideBatchProps>();
  verdicts = new Map<string, RideVerdictProps>();
  signIns: SignInRecord[] = [];
  adminActions: AdminActionRecord[] = [];
  private seq = 0;
  private roundSeq = 0;

  nextSeq(): number { return ++this.seq; }
  nextRoundId(): number { return ++this.roundSeq; }

  reset(): void {
    this.players.clear(); this.challenges.clear(); this.rides.clear(); this.batches.clear(); this.verdicts.clear();
    this.rounds = []; this.payments = []; this.unlocks = []; this.signIns = []; this.adminActions = [];
    this.seq = 0; this.roundSeq = 0;
  }
}
