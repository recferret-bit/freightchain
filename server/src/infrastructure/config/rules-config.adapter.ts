import { Injectable } from '@nestjs/common';
import { MINUTE_MS } from '../../domain/shared/time.js';
import { RulesConfigPort, type RulesConfig } from '../../application/ports/config/rules-config.port.js';
import { EnvService } from './env.service.js';

const HEARTBEAT_TIMEOUT_MS = 150_000; // background tabs throttle timers to ~1/min, so be generous; the game pauses (and keeps beating) when hidden
const QUOTE_TTL_MS = 10 * MINUTE_MS;
const NONCE_TTL_MS = 5 * MINUTE_MS;
const FREE_ON_SIGNUP = 5;
const FREE_RIDES_MAX = 5;

@Injectable()
export class EnvRulesConfigAdapter extends RulesConfigPort {
  private readonly rules: RulesConfig;

  constructor(env: EnvService) {
    super();
    this.rules = {
      freeOnSignup: FREE_ON_SIGNUP, freeRidesMax: FREE_RIDES_MAX, freeRideSeconds: env.freeRideSeconds, hbMinIntervalMs: env.hbMinIntervalMs, hbTimeoutMs: HEARTBEAT_TIMEOUT_MS,
      quoteTtlMs: QUOTE_TTL_MS, nonceTtlMs: NONCE_TTL_MS, demoWallets: env.demoWallets, demoScale: env.demoScale,
      initialSeedLamports: env.initialSeedLamports, treasury: env.treasuryPubkey, appDomain: env.appDomain, appOrigin: env.appOrigin,
      paymentMode: env.paymentMode, programId: env.ticketProgramId, feeTreasury: env.feeTreasury, seedTreasury: env.seedTreasury, watchIntervalMs: env.watchIntervalMs,
      orderTtlMs: env.orderTtlMs, commitment: env.solanaCommitment, sponsorEnabled: env.feePayerSecret !== undefined, crankEnabled: env.crankSecret !== undefined,
      sponsorPerWalletPerDay: env.sponsorPerWalletPerDay, priorityFee: env.priorityFee,
      sessionTtlHours: env.onchainSessionTtlHours,
    };
  }

  get(): RulesConfig {
    return this.rules;
  }
}
