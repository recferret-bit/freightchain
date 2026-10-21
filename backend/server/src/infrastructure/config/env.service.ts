import type { LiveFlags } from '../../domain/live/live-features.js';
import { createHash, randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Injectable, Logger } from '@nestjs/common';
import { defaultClientDir, defaultLandingDir } from './client-dir.js';
import { validateEnv, type EnvConfig } from './env.schema.js';
import { isWalletAddress } from '../../domain/players/wallet-address.js';

const PROJECT_TOKEN = /^phc_[A-Za-z0-9]+$/;

/** Typed access to the environment, validated with the Zod schema when the app is created (so every app instance – and every test harness – sees the env as it is NOW). */
@Injectable()
export class EnvService {
  private readonly env: EnvConfig = validateEnv(process.env);
  private readonly treasury: string = this.resolveTreasury();
  private devSecret?: string;
  private posthogKeyWarned = false;

  get port(): number { return this.env.PORT; }
  get nodeEnv(): string { return this.env.NODE_ENV; }
  get isProduction(): boolean { return this.nodeEnv === 'production'; }
  /** development and test are the only modes that may carry demo wallets, fake LLMs, or ride-changing donations. */
  get isStrict(): boolean { return this.nodeEnv !== 'development' && this.nodeEnv !== 'test'; }
  /** Unset (including `KEY=`): strict outside production, warn in production. */
  get responseSchemaCheck(): 'off' | 'warn' | 'strict' {
    return this.env.RESPONSE_SCHEMA_CHECK ?? (this.isProduction ? 'warn' : 'strict');
  }
  get databaseUrl(): string { return this.env.DATABASE_URL; }
  /** Production REQUIRES JWT_SECRET (validated). Otherwise a RANDOM secret per boot – never a constant: a deploy that forgot NODE_ENV=production must not sign sessions with a publicly known key. */
  get hasStableJwtSecret(): boolean { return !!this.env.JWT_SECRET; }
  get jwtSecret(): string {
    if (this.env.JWT_SECRET) return this.env.JWT_SECRET;
    if (!this.devSecret) {
      this.devSecret = randomBytes(32).toString('hex');
      new Logger('EnvService').warn('JWT_SECRET is not set: using a random secret for this run (sessions end when the server restarts). Set JWT_SECRET (>= 32 chars) to keep them.');
    }
    return this.devSecret;
  }
  get sessionTtlDays(): number { return this.env.SESSION_TTL_DAYS; }
  /** the admin session's key: ADMIN_JWT_SECRET, else derived from the player secret (never the same bytes – a player token is not an admin token even before the audience check) */
  get adminJwtSecret(): string { return this.env.ADMIN_JWT_SECRET ?? createHash('sha256').update(`${this.jwtSecret}:admin-session`).digest('hex'); }
  get adminSessionTtlMinutes(): number { return Math.min(this.env.ADMIN_SESSION_TTL_MINUTES, 60); }
  get moderatorWallets(): ReadonlySet<string> {
    return new Set(this.env.MODERATOR_WALLETS.split(',').map((w) => w.trim()).filter((w) => w.length > 0));
  }
  /** ADMIN_IP_ALLOWLIST as written ('' = any IP). */
  get adminIpAllowlist(): string { return this.env.ADMIN_IP_ALLOWLIST; }
  get adminAlertTelegramBotToken(): string | undefined { return this.env.ADMIN_ALERT_TELEGRAM_BOT_TOKEN; }
  get adminAlertTelegramChatId(): string | undefined { return this.env.ADMIN_ALERT_TELEGRAM_CHAT_ID; }
  get adminApprovalMode(): 'single' | 'dual' { return this.env.ADMIN_APPROVAL_MODE; }
  get throttleAdminAuthLimit(): number { return this.env.THROTTLE_ADMIN_AUTH_LIMIT; }
  /** the entity editor's session key: EDITOR_JWT_SECRET, else derived from the player secret (neither the player's nor the admin's bytes) */
  get editorJwtSecret(): string { return this.env.EDITOR_JWT_SECRET ?? createHash('sha256').update(`${this.jwtSecret}:editor-session`).digest('hex'); }
  get editorSessionTtlMinutes(): number { return Math.min(this.env.EDITOR_SESSION_TTL_MINUTES, 60); }
  /** who may use the 3D model editor (empty = nobody: every editor route is a 404) */
  get editorWallets(): ReadonlySet<string> {
    return new Set(this.env.EDITOR_WALLETS.split(',').map((w) => w.trim()).filter((w) => w.length > 0));
  }
  /** Local storybook only: no wallet sign-in. The editor acts as the first EDITOR_WALLETS address. Never true in production. */
  get editorOpen(): boolean { return this.env.EDITOR_OPEN === '1' && !this.isProduction; }
  /** EDITOR_IP_ALLOWLIST as written ('' = any IP); infrastructure/config/ip-rules.ts matches it */
  get editorIpAllowlist(): string { return this.env.EDITOR_IP_ALLOWLIST; }
  /** split deployment: the only host the editor API answers on (storybook.<COOKIE_DOMAIN>, nginx proxies /api/editor/ there); null = single origin, any host */
  get editorHost(): string | null { return this.env.COOKIE_DOMAIN ? `storybook.${this.env.COOKIE_DOMAIN.replace(/^\./, '')}`.toLowerCase() : null; }
  get appDomain(): string { return this.env.APP_DOMAIN; }
  get appOrigin(): string { return this.env.APP_ORIGIN; }
  /** the site folder (default: ../client, resolved from this module so it works from src/ and from dist/) */
  get clientDir(): string { return this.env.CLIENT_DIR ?? defaultClientDir(); }
  get landingDir(): string { return this.env.LANDING_DIR ?? defaultLandingDir(); }
  get cookieDomain(): string | undefined { return this.env.COOKIE_DOMAIN; }
  /** the player session cookie's name: host-only `__Host-fc_session` in production (audit H7-B), `fc_session` elsewhere */
  get sessionCookie(): string { return this.isProduction ? '__Host-fc_session' : 'fc_session'; }
  /** storybook editor session: `__Host-` in production (no Domain, Path=/), `fc_editor` on Path /api/editor otherwise */
  get editorCookie(): string { return this.isProduction ? '__Host-fc_editor' : 'fc_editor'; }
  get editorCookiePath(): string { return this.isProduction ? '/' : '/api/editor'; }
  /** exact browser origins (scheme + host) that may call the API with the session cookie; empty = CORS off (single origin) */
  get corsOrigins(): string[] { return this.env.CORS_ORIGINS.split(',').map((o) => o.trim().replace(/\/$/, '')).filter((o) => o.length > 0); }
  get trustProxy(): number { return this.env.TRUST_PROXY ?? 0; }
  get throttleLimit(): number { return this.env.THROTTLE_LIMIT; }
  get throttleAuthLimit(): number { return this.env.THROTTLE_AUTH_LIMIT; }
  get throttlePromoLimit(): number { return this.env.THROTTLE_PROMO_LIMIT; }
  /** the AI model editor – SECRETS: only the LLM adapters read the keys; nothing logs or returns them */
  get llmKeys(): { anthropic?: string; openai?: string; gemini?: string; zai?: string; xai?: string } {
    return { anthropic: this.env.ANTHROPIC_API_KEY, openai: this.env.OPENAI_API_KEY, gemini: this.env.GEMINI_API_KEY, zai: this.env.ZAI_API_KEY, xai: this.env.XAI_API_KEY };
  }
  get zaiBaseUrl(): string { return this.env.ZAI_BASE_URL; }
  get xaiBaseUrl(): string { return this.env.XAI_BASE_URL; }
  get editorDefaultProvider(): string | null { return this.env.EDITOR_DEFAULT_PROVIDER ?? null; }
  get editorModels(): { anthropic?: string; openai?: string; gemini?: string; zai?: string; xai?: string } {
    return { anthropic: this.env.EDITOR_MODEL_ANTHROPIC, openai: this.env.EDITOR_MODEL_OPENAI, gemini: this.env.EDITOR_MODEL_GEMINI, zai: this.env.EDITOR_MODEL_ZAI, xai: this.env.EDITOR_MODEL_XAI };
  }
  get editorMcpUrl(): string { return this.env.EDITOR_MCP_URL.replace(/\/$/, ''); }
  /** SECRET shared with the mcp service; undefined = the AI editor is off */
  get editorMcpToken(): string | undefined { return this.env.EDITOR_MCP_TOKEN; }
  get editorJobTimeoutMs(): number { return this.env.EDITOR_JOB_TIMEOUT_MS; }
  /** test only: the scripted fake provider (the schema refuses it in production) */
  get editorFakeLlm(): boolean { return this.env.EDITOR_FAKE_LLM === '1' && !this.isProduction; }
  get throttleEntitiesLimit(): number { return this.env.THROTTLE_ENTITIES_LIMIT; }
  get throttleEditorLimit(): number { return this.env.THROTTLE_EDITOR_LIMIT; }
  get throttleAuthRps(): number { return this.env.THROTTLE_AUTH_RPS; }
  get throttleEntitiesRps(): number { return this.env.THROTTLE_ENTITIES_RPS; }
  get throttleEditorRps(): number { return this.env.THROTTLE_EDITOR_RPS; }
  get throttleMcpLimit(): number { return this.env.THROTTLE_MCP_LIMIT; }
  get throttleMcpRps(): number { return this.env.THROTTLE_MCP_RPS; }
  get freeRideSeconds(): number { return this.env.FREE_RIDE_SECONDS; }
  get hbMinIntervalMs(): number { return this.env.HB_MIN_INTERVAL_MS; }
  get hbTimeoutMs(): number { return this.env.HB_TIMEOUT_MS; }
  get solanaRpc(): string { return this.env.SOLANA_RPC; }
  get snsRpc(): string { return this.env.SNS_RPC; }
  get snsRpcFallbacks(): string[] {
    return this.env.SNS_RPC_FALLBACKS.split(',').map((u) => u.trim()).filter((u) => u.length > 0);
  }
  get snsCacheTtlSeconds(): number { return this.env.SNS_CACHE_TTL_SECONDS; }
  get snsNegativeCacheTtlSeconds(): number { return this.env.SNS_NEGATIVE_CACHE_TTL_SECONDS; }
  get solUsdFixed(): number | undefined { return this.env.SOL_USD || undefined; }
  get demoScale(): number { return this.env.DEMO_SCALE; }

  // ---- paid tickets (docs/spec/pool.md)
  get ticketProgramId(): string { return this.env.TICKET_PROGRAM_ID ?? ''; }
  /** the program when one is configured (unless forced to 'transfer'), else plain transfers */
  get paymentMode(): 'program' | 'transfer' { return this.env.PAYMENT_MODE ?? (this.env.TICKET_PROGRAM_ID ? 'program' : 'transfer'); }
  get feeTreasury(): string { return this.env.FEE_TREASURY ?? ''; }
  get seedTreasury(): string { return this.env.SEED_TREASURY ?? ''; }
  /** the websocket endpoint ('' = derive wss:// from SOLANA_RPC) */
  get solanaWs(): string { return this.env.SOLANA_WS ?? ''; }
  get solanaRpcFallbacks(): string[] { return this.env.SOLANA_RPC_FALLBACKS.split(',').map((u) => u.trim()).filter((u) => u.length > 0); }
  get solanaCommitment(): 'confirmed' | 'finalized' { return this.env.SOLANA_COMMITMENT; }
  get watchIntervalMs(): number { return this.env.WATCH_INTERVAL_MS; }
  get redisUrl(): string | undefined { return this.env.REDIS_URL; }
  get crankIntervalMs(): number { return this.env.CRANK_INTERVAL_MS; }
  get priorityFee(): { percentile: number; minMicrolamports: number; maxMicrolamports: number } {
    return { percentile: this.env.PRIORITY_FEE_PERCENTILE, minMicrolamports: this.env.PRIORITY_FEE_MIN_MICROLAMPORTS, maxMicrolamports: this.env.PRIORITY_FEE_MAX_MICROLAMPORTS };
  }
  get orderTtlMs(): number { return this.env.ORDER_TTL_MINUTES * 60_000; }
  get onchainSessionTtlHours(): number { return this.env.ONCHAIN_SESSION_TTL_HOURS; }
  /** SECRETS – used only by the infrastructure that signs / authenticates; never copied into RulesConfig or logged. undefined = the feature is off. */
  get webhookSecret(): string | undefined { return this.env.WEBHOOK_SECRET; }
  get crankSecret(): string | undefined { return this.env.CRANK_SECRET; }
  get payoutSecret(): string | undefined { return this.env.PAYOUT_SECRET; }
  get payoutIntervalMs(): number { return this.env.PAYOUT_INTERVAL_MS; }
  get achievementMintSecret(): string | undefined { return this.env.ACHIEVEMENT_MINT_SECRET; }
  get honkProgramId(): string | undefined { return this.env.HONK_PROGRAM_ID; }
  get honkEmitterSecret(): string | undefined { return this.env.HONK_EMITTER_SECRET; }
  get achievementTree(): string | undefined { return this.env.ACHIEVEMENT_TREE; }
  get achievementCollection(): string | undefined { return this.env.ACHIEVEMENT_COLLECTION; }
  get achievementMintIntervalMs(): number { return this.env.ACHIEVEMENT_MINT_INTERVAL_MS; }
  get achievementMintDelayMs(): number { return this.env.ACHIEVEMENT_MINT_DELAY_MS; }
  get achievementMintBatch(): number { return this.env.ACHIEVEMENT_MINT_BATCH; }
  get initialSeedLamports(): number { return Math.round(this.env.INITIAL_SEED_SOL * 1e9); }
  get trafficProofRequired(): boolean { return this.env.TRAFFIC_PROOF_REQUIRED; }
  get verdictEnforce(): boolean { return this.env.VERDICT_ENFORCE; }
  get telemetryRetentionDays(): number { return this.env.TELEMETRY_RETENTION_DAYS; }
  get telemetryV21(): 'off' | 'shadow' | 'enforce' { return this.env.TELEMETRY_V21; }
  get signInRetentionDays(): number { return this.env.SIGNIN_RETENTION_DAYS; }
  get challengeIntervalSeconds(): number { return this.env.CHALLENGE_INTERVAL_SECONDS; }
  get challengeFreeRides(): boolean { return this.env.CHALLENGE_FREE_RIDES === 'on'; }
  get minigamesMode(): 'off' | 'shadow' | 'enforce' { return this.env.MINIGAMES; }
  get mgSecret(): string | undefined { return this.env.MG_SECRET; }
  get mgSaltVersion(): string { return this.env.MG_SALT_VERSION; }
  get liveFlags(): LiveFlags {
    return { chat: this.env.LIVE_CHAT, donations: this.env.LIVE_DONATIONS === 'on', freeDonations: this.env.LIVE_FREE_DONATIONS === 'on', effects: this.env.LIVE_EFFECTS };
  }
  get pledgesEnabled(): boolean { return this.env.PLEDGES_ENABLED === '1'; }
  /** who may use the admin page (empty = nobody: the admin routes answer 404) */
  get adminWallets(): ReadonlySet<string> {
    return new Set(this.env.ADMIN_WALLETS.split(',').map((w) => w.trim()).filter((w) => w.length > 0));
  }
  /** split deployment: the only host the admin API answers on (admin.<COOKIE_DOMAIN>, behind nginx basic auth); null = single origin, any host */
  /** split deployment: the game's host (ride.<COOKIE_DOMAIN>) – the watch page signs in from there; null = single origin */
  get gameHost(): string | null { return this.env.COOKIE_DOMAIN ? `ride.${this.env.COOKIE_DOMAIN.replace(/^\./, '')}`.toLowerCase() : null; }
  get adminHost(): string | null { return this.env.COOKIE_DOMAIN ? `admin.${this.env.COOKIE_DOMAIN.replace(/^\./, '')}`.toLowerCase() : null; }

  get demoWallets(): ReadonlySet<string> {
    return new Set(this.env.DEMO_WALLETS.split(',').map((w) => w.trim()).filter((w) => w.length > 0));
  }

  /** Where entry fees go – a PUBLIC key only (the server holds no payout secret). '' = paid rides disabled. Resolved and VALIDATED once, at construction (= at boot). */
  get treasuryPubkey(): string {
    return this.treasury;
  }

  /** `phc_…` project token, or null. A missing key and a non-token (a pasted `phx_`) are both "off" – the value is never logged. */
  get posthogKey(): string | null {
    const key = this.env.POSTHOG_KEY;
    if (!key) return null;
    if (PROJECT_TOKEN.test(key)) return key;
    if (!this.posthogKeyWarned) {
      this.posthogKeyWarned = true;
      new Logger('EnvService').warn('analytics disabled: POSTHOG_KEY is not a project token');
    }
    return null;
  }

  get posthogHost(): string { return this.env.POSTHOG_HOST; }

  /** Global opt-in. Only `1` or `true` may send. Unset, empty, `0`, and `false` stay off even with a project token. */
  get posthogEnabled(): boolean { return this.env.POSTHOG_ENABLED === '1' || this.env.POSTHOG_ENABLED === 'true'; }

  /** Kill switch. `1` or `true` force capture off even when POSTHOG_ENABLED is on. */
  get posthogDisabled(): boolean { return this.env.POSTHOG_DISABLED === '1' || this.env.POSTHOG_DISABLED === 'true'; }

  /** Operator id. Not part of the capture body. */
  get posthogProjectId(): string | null { return this.env.POSTHOG_PROJECT_ID ?? null; }

  /** Capture runs only with a real project token, POSTHOG_ENABLED of `1` or `true`, and the kill switch off. */
  get analyticsEnabled(): boolean { return this.posthogKey !== null && this.posthogEnabled && !this.posthogDisabled; }

  /** Empty = the code defaults in prize-rules.ts. A non-empty list replaces that default. */
  get prizeSanctionedCountries(): string { return this.env.PRIZE_SANCTIONED_COUNTRIES; }
  /** ISO country used only when NODE_ENV is development or test and the edge country is missing. lane1:PRIZE_DEV_DEFAULT_COUNTRY */
  get prizeDevDefaultCountry(): string { return this.env.PRIZE_DEV_DEFAULT_COUNTRY; }
  get prizeBlockedCountries(): string { return this.env.PRIZE_BLOCKED_COUNTRIES; }
  get prizeBlockedUsStates(): string { return this.env.PRIZE_BLOCKED_US_STATES; }

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
