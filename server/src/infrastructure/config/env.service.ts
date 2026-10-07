import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Injectable, Logger } from '@nestjs/common';
import { defaultClientDir } from './client-dir.js';
import { validateEnv, type EnvConfig } from './env.schema.js';
import { isWalletAddress } from '../../domain/players/wallet-address.js';

/** Typed access to the environment, validated with the Zod schema when the app is created (so every app instance – and every test harness – sees the env as it is NOW). */
@Injectable()
export class EnvService {
  private readonly env: EnvConfig = validateEnv(process.env);
  private readonly treasury: string = this.resolveTreasury();
  private devSecret?: string;

  get port(): number { return this.env.PORT; }
  get nodeEnv(): string { return this.env.NODE_ENV; }
  get isProduction(): boolean { return this.nodeEnv === 'production'; }
  get databaseUrl(): string { return this.env.DATABASE_URL; }
  /** Production REQUIRES JWT_SECRET (validated). Otherwise a RANDOM secret per boot – never a constant: a deploy that forgot NODE_ENV=production must not sign sessions with a publicly known key. */
  get jwtSecret(): string {
    if (this.env.JWT_SECRET) return this.env.JWT_SECRET;
    if (!this.devSecret) {
      this.devSecret = randomBytes(32).toString('hex');
      new Logger('EnvService').warn('JWT_SECRET is not set: using a random secret for this run (sessions end when the server restarts). Set JWT_SECRET (>= 32 chars) to keep them.');
    }
    return this.devSecret;
  }
  get sessionTtlDays(): number { return this.env.SESSION_TTL_DAYS; }
  get appDomain(): string { return this.env.APP_DOMAIN; }
  get appOrigin(): string { return this.env.APP_ORIGIN; }
  /** the site folder (default: ../client, resolved from this module so it works from src/ and from dist/) */
  get clientDir(): string { return this.env.CLIENT_DIR ?? defaultClientDir(); }
  get trustProxy(): number { return this.env.TRUST_PROXY ?? 0; }
  get throttleLimit(): number { return this.env.THROTTLE_LIMIT; }
  get throttleAuthLimit(): number { return this.env.THROTTLE_AUTH_LIMIT; }
  get freeRideSeconds(): number { return this.env.FREE_RIDE_SECONDS; }
  get hbMinIntervalMs(): number { return this.env.HB_MIN_INTERVAL_MS; }
  get solanaRpc(): string { return this.env.SOLANA_RPC; }
  get solUsdFixed(): number | undefined { return this.env.SOL_USD || undefined; }
  get demoScale(): number { return this.env.DEMO_SCALE; }
  get initialSeedLamports(): number { return Math.round(this.env.INITIAL_SEED_SOL * 1e9); }

  get demoWallets(): ReadonlySet<string> {
    return new Set(this.env.DEMO_WALLETS.split(',').map((w) => w.trim()).filter((w) => w.length > 0));
  }

  /** Where entry fees go – a PUBLIC key only (the server holds no payout secret). '' = paid rides disabled. Resolved and VALIDATED once, at construction (= at boot). */
  get treasuryPubkey(): string {
    return this.treasury;
  }

  /** TREASURY_PUBKEY, else – outside production and tests – data/treasury.json written by `npm run treasury:init`. A file that is there but invalid stops the boot. */
  private resolveTreasury(): string {
    if (this.env.TREASURY_PUBKEY) return this.env.TREASURY_PUBKEY; // validated by the schema
    if (this.env.NODE_ENV === 'production' || this.env.NODE_ENV === 'test') return '';
    const file = join(process.cwd(), 'data', 'treasury.json');
    let publicKey: unknown;
    try {
      publicKey = (JSON.parse(readFileSync(file, 'utf8')) as { publicKey?: unknown }).publicKey;
    } catch {
      return ''; // no file: paid rides disabled
    }
    if (!isWalletAddress(publicKey)) throw new Error(`${file}: publicKey is not a base58 Solana address – fix it or delete the file and run npm run treasury:init`);
    return publicKey;
  }
}
