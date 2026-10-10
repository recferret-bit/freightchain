import { RecordingAnalytics } from './recording-analytics.js';
import { RulesConfigPort, type RulesConfig } from '../../src/application/ports/config/rules-config.port.js';
import { EntropyPort } from '../../src/application/ports/shared/entropy.port.js';
import { AchievementService } from '../../src/application/services/achievement.service.js';
import { PaymentSettlementService } from '../../src/application/services/payment-settlement.service.js';
import { PlayerSessionService } from '../../src/application/services/player-session.service.js';
import { MeProfileService } from '../../src/application/services/me-profile.service.js';
import { PromoCreationService } from '../../src/application/services/promo-creation.service.js';
import { PoolTicketsService } from '../../src/application/services/pool-tickets.service.js';
import { TicketSettlementService } from '../../src/application/services/ticket-settlement.service.js';
import { PoolRegistryService } from '../../src/application/services/pool-registry.service.js';
import { RideLookupService } from '../../src/application/services/ride-lookup.service.js';
import { RoundService } from '../../src/application/services/round.service.js';
import { VerdictService } from '../../src/application/services/verdict.service.js';
import { AdminProofService } from '../../src/application/services/admin-proof.service.js';
import { NaclSignatureVerifier } from '../../src/infrastructure/auth/nacl.signature-verifier.js';
import { Player } from '../../src/domain/players/player.entity.js';
import { Ride } from '../../src/domain/rides/ride.entity.js';
import { FakeChain, TREASURY } from './fake-chain.js';
import { FakePoolChain } from './fake-pool-chain.js';
import { FakeClock } from './fake-clock.js';
import { MemoryDb } from './in-memory/memory-db.js';
import {
  MemoryAchievementRepository, MemoryChallengeRepository, MemoryHealthProbe, MemoryPaymentRepository, MemoryPlayerRepository,
  MemoryRideBatchRepository, MemoryRideQuery, MemoryRideVerdictRepository, MemorySignInRepository, MemoryAdminActionRepository, MemoryAdminQuery, MemoryRideRepository, MemoryRoundRepository, MemoryTransaction,
} from './in-memory/memory-repositories.js';
import { MemoryCosmeticRepository, MemoryPoolPayoutRepository, MemoryPoolRepository, MemoryPromoRepository, MemoryRideTicketRepository, MemoryTicketOrderRepository } from './in-memory/memory-ledger-repositories.js';
import { MemoryChainCursorRepository, MemoryChainEventRepository } from './in-memory/memory-repositories.js';
import { TestHasher } from './recording.js';
import { MemoryDonationOrderRepository, MemoryRideEventRepository, MemoryRideMuteRepository } from './in-memory/memory-live-repositories.js';
import { MemoryViewerPresenceAdapter } from '../../src/infrastructure/live/viewer-presence.memory.adapter.js';
import { MemorySitePresenceAdapter } from '../../src/infrastructure/live/site-presence.memory.adapter.js';
import { StatsService } from '../../src/application/services/stats.service.js';
import { MemoryStatsRepository } from './in-memory/memory-stats-repository.js';
import { MemoryCacheAdapter } from '../../src/infrastructure/cache/memory-cache.adapter.js';
import { GameSettingsService } from '../../src/application/services/game-settings.service.js';
import { LiveAccessService } from '../../src/application/services/live-access.service.js';
import { MemoryOfflineRideRepository, MemorySettingsRepository } from './in-memory/memory-settings.js';

/** Fixed rules for unit tests: 10 s free shift (140 m), treasury configured, one demo wallet. */
export const DEMO_UNIT_WALLET = 'DemoWa11et1111111111111111111111111111111111';
/** the one wallet in the unit rules' ADMIN_WALLETS (a valid address; specs that sign use their own keypair and pass it in the rules) */
export const ADMIN_UNIT_WALLET = 'GseaEsNWMLScZ5RH8yQ4xmoCP97H86HjLSA9xkyFCqbn';
export const unitRules = (over: Partial<RulesConfig> = {}): RulesConfig => ({
  freeOnSignup: 5, freeRidesMax: 5, freeRideSeconds: 10, hbMinIntervalMs: 1000, hbTimeoutMs: 150_000, quoteTtlMs: 600_000, nonceTtlMs: 300_000,
  demoWallets: new Set([DEMO_UNIT_WALLET]), demoScale: 60, initialSeedLamports: 0, treasury: TREASURY, appDomain: 'freight.test', appOrigin: 'https://freight.test', gameDomain: null, gameOrigin: null,
  paymentMode: 'transfer', programId: '', feeTreasury: '', seedTreasury: '', watchIntervalMs: 0, orderTtlMs: 3_600_000, commitment: 'confirmed', crankEnabled: false,
  priorityFee: { percentile: 75, minMicrolamports: 0, maxMicrolamports: 50_000 }, sessionTtlHours: 24,
  verdictEnforce: true, telemetryRetentionDays: 90, signInRetentionDays: 180, challengeIntervalSeconds: 240, challengeFreeRides: true, live: { chat: 'all', donations: true, freeDonations: true, effects: 'all' }, adminWallets: new Set([ADMIN_UNIT_WALLET]), adminDomain: 'freight.test', adminOrigin: 'https://freight.test',
  ...over,
});

export class FixedRules extends RulesConfigPort {
  constructor(private readonly rules: RulesConfig = unitRules()) { super(); }
  get(): RulesConfig { return this.rules; }
}

/** Deterministic ids, nonces and seeds. */
export class SequenceEntropy extends EntropyPort {
  private n = 0;
  uuid(): string { this.n++; return `00000000-0000-4000-8000-${String(this.n).padStart(12, '0')}`; }
  hex(bytes: number): string { this.n++; return String(this.n).padStart(bytes * 2, '0'); }
  seed31(): number { this.n++; return 1000 + this.n; }
}

/**
 * The application layer on in-memory ports: real services, fake clock / chain / entropy, in-memory repositories. Handler and service specs construct the
 * class under test from these, so they test real behaviour without a database (the repositories have their own integration specs on PostgreSQL).
 */
export function unitContext(rules: RulesConfig = unitRules()) {
  const db = new MemoryDb();
  const clock = new FakeClock();
  const chain = new FakeChain();
  const entropy = new SequenceEntropy();
  const rulesPort = new FixedRules(rules);
  const transactions = new MemoryTransaction();
  const players = new MemoryPlayerRepository(db);
  const challenges = new MemoryChallengeRepository(db);
  const rides = new MemoryRideRepository(db);
  const rideQuery = new MemoryRideQuery(db);
  const roundRepo = new MemoryRoundRepository(db);
  const payments = new MemoryPaymentRepository(db);
  const unlocks = new MemoryAchievementRepository(db);
  const batches = new MemoryRideBatchRepository(db);
  const hasher = new TestHasher();
  const verdictRepo = new MemoryRideVerdictRepository(db);
  const signIns = new MemorySignInRepository(db);
  const adminActions = new MemoryAdminActionRepository(db);
  const adminQuery = new MemoryAdminQuery(db);
  const health = new MemoryHealthProbe();
  const analytics = new RecordingAnalytics();
  const pools = new MemoryPoolRepository(db);
  const poolPayouts = new MemoryPoolPayoutRepository(db);
  const tickets = new MemoryRideTicketRepository(db);
  const promos = new MemoryPromoRepository(db);
  const cosmetics = new MemoryCosmeticRepository(db);
  const promoCreation = new PromoCreationService(promos, pools, clock);
  const orders = new MemoryTicketOrderRepository(db);
  const poolTickets = new PoolTicketsService(pools, tickets);
  const poolChain = new FakePoolChain();
  const chainEvents = new MemoryChainEventRepository(db);
  const chainCursors = new MemoryChainCursorRepository(db);
  const rideEvents = new MemoryRideEventRepository(db);
  const viewers = new MemoryViewerPresenceAdapter();
  const sitePresence = new MemorySitePresenceAdapter();
  const rideMutes = new MemoryRideMuteRepository(db);
  const donationOrders = new MemoryDonationOrderRepository(db);
  const liveAccess = new LiveAccessService(rides, rideMutes, rulesPort);
  const statsRepo = new MemoryStatsRepository(db);
  const cache = new MemoryCacheAdapter(clock);
  const stats = new StatsService(statsRepo, cache, clock);
  const settingsRepo = new MemorySettingsRepository(db);
  const settings = new GameSettingsService(settingsRepo);
  const offlineRides = new MemoryOfflineRideRepository(db);
  const sessions = new PlayerSessionService(players, settings, rulesPort, clock, analytics);
  const lookup = new RideLookupService(rides);
  const meProfile = new MeProfileService(rulesPort, poolTickets, rides);
  const rounds = new RoundService(roundRepo, rulesPort, transactions, clock, analytics);
  const achievements = new AchievementService(unlocks, rideQuery, clock, rulesPort);
  const ticketSettlement = new TicketSettlementService(players, pools, tickets, orders, sessions, rounds, transactions, clock, entropy);
  const registry = new PoolRegistryService(poolChain, pools, clock, entropy);
  const verdicts = new VerdictService(rides, players, batches, verdictRepo, adminActions, transactions, clock);
  const proofs = new AdminProofService(challenges, new NaclSignatureVerifier(), rulesPort, clock, entropy);
  const settlement = new PaymentSettlementService(rounds, roundRepo, payments, rides, players, lookup, transactions, clock);

  const now = () => clock.now();
  /** a registered player (10 signup rides, daily cap 5) */
  const player = async (wallet: string) => sessions.touch(wallet);
  /** a stored free ride, optionally started */
  const freeRide = async (wallet: string, started = false) => {
    await player(wallet);
    const ride = Ride.createFree({ id: entropy.uuid(), wallet, seed: entropy.seed31(), minSeconds: rules.freeRideSeconds, now: now() });
    if (started) ride.start(now());
    await rides.insert(ride);
    return ride;
  };
  /** a stored paid order (awaiting payment) */
  const paidOrder = async (wallet: string, lamports = 50_000_000) => {
    await player(wallet);
    const ride = Ride.createPaidOrder({ id: entropy.uuid(), wallet, tier: '1h', seed: entropy.seed31(), minSeconds: 3600, timeScale: 1, priceUsd: 5, lamports, solUsd: 100, now: now(), quoteTtlMs: rules.quoteTtlMs });
    await rides.insert(ride);
    return ride;
  };
  const reload = async (id: string) => (await rides.findById(id)) as Ride;
  const storedPlayer = async (wallet: string) => (await players.findByWallet(wallet)) as Player;

  return {
    db, clock, chain, entropy, rules: rulesPort, transactions, players, challenges, rides, rideQuery, roundRepo, payments, unlocks, batches, hasher, verdictRepo, verdicts, proofs, signIns, adminActions, adminQuery, health, analytics,
    pools, poolPayouts, tickets, promos, cosmetics, promoCreation, orders, poolTickets, ticketSettlement,
    sessions, meProfile, settings, settingsRepo, offlineRides, lookup, rounds, achievements, settlement, now, player, freeRide, paidOrder, reload, storedPlayer,
    poolChain, chainEvents, chainCursors, registry, rideEvents, viewers, sitePresence, rideMutes, donationOrders, liveAccess, statsRepo, cache, stats,
  };
}
export type UnitContext = ReturnType<typeof unitContext>;
