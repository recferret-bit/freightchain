import { z } from 'zod';
import { isWalletAddress } from '../../domain/players/wallet-address.js';

/** `KEY=` in a .env file arrives as an empty string – treat it as "not set". */
const optional = <T extends z.ZodTypeAny>(schema: T) => z.preprocess((v) => (v === '' ? undefined : v), schema.optional());

export const envSchema = z
  .object({
    PORT: z.coerce.number().int().positive().default(3000),
    NODE_ENV: z.string().min(1).default('development'), // 'production' switches the strict checks on; anything else (staging, test, …) is accepted
    DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
    JWT_SECRET: optional(z.string().min(32, 'JWT_SECRET must be at least 32 characters')),
    SESSION_TTL_DAYS: z.coerce.number().int().positive().default(7),
    APP_DOMAIN: z.string().min(1).default('localhost:3000'),
    APP_ORIGIN: z.string().min(1).default('http://localhost:3000'),
    CLIENT_DIR: optional(z.string()),
    LANDING_DIR: optional(z.string()),
    /** Split deployment (landing / game / api on sibling subdomains): the session cookie's Domain (e.g. freightchain.fun, shared by all subdomains) and the browser origins allowed to call the API with it. Unset = single origin. */
    COOKIE_DOMAIN: optional(z.string().regex(/^[a-z0-9.-]+$/i, 'COOKIE_DOMAIN must be a bare host name (no scheme, no port)')),
    CORS_ORIGINS: z.string().default(''),
    TRUST_PROXY: optional(z.coerce.number().int().min(0)),
    THROTTLE_LIMIT: z.coerce.number().int().positive().default(600),
    THROTTLE_AUTH_LIMIT: z.coerce.number().int().positive().default(30),
    THROTTLE_PROMO_LIMIT: z.coerce.number().int().positive().default(30),
    FREE_RIDE_SECONDS: z.coerce.number().positive().default(180),
    HB_MIN_INTERVAL_MS: z.coerce.number().int().min(0).default(1000),
    HB_TIMEOUT_MS: z.coerce.number().int().min(5000).default(150_000), // no heartbeat for this long = the tab is gone: off the live feed, its next heartbeat would fail it, the stale-ride sweeper ends it (failed · heartbeat lost)
    TREASURY_PUBKEY: optional(z.string()),
    SOLANA_RPC: z.string().min(1).default('https://api.devnet.solana.com'),
    SOL_USD: optional(z.coerce.number().min(0)), // 0 = not pinned (live price), as before
    DEMO_WALLETS: z.string().default(''),
    DEMO_SCALE: z.coerce.number().positive().default(60),
    INITIAL_SEED_SOL: z.coerce.number().min(0).default(0),
    /** Project token (`phc_…`). Empty is unset. A non-token is refused by EnvService, not by this schema, so a pasted personal key cannot stop boot. */
    POSTHOG_KEY: optional(z.string()),
    POSTHOG_HOST: z.preprocess((v) => (v === '' ? undefined : v), z.string().url().default('https://eu.i.posthog.com')),
    /** Global opt-in. Only `1` / `true` may send. `0` / `false` / empty / unset stay off even with a project token. Not a coerced boolean. */
    POSTHOG_ENABLED: optional(z.enum(['1', 'true', '0', 'false'])),
    /** Kill switch. `1` / `true` disable capture even when POSTHOG_ENABLED is on. Not a coerced boolean (`"false"` must not become true). */
    POSTHOG_DISABLED: optional(z.enum(['1', 'true', '0', 'false'])),
    /** Stored for operators. Never sent on capture. */
    POSTHOG_PROJECT_ID: optional(z.string()),
    /** Cache for the public statistics (docs/statistics.md): `redis://[:password@]host:6379`. Unset / empty = an in-process cache (dev, tests). A Redis that is down is a miss, never an error. */
    REDIS_URL: optional(z.string().url()),
    // ---- paid tickets (docs/paid-tickets-plan.md §2.1). Nothing here is required yet: today's deploy keeps booting; the workstreams add their own production checks.
    /** 'program' = escrow pools through the Anchor program, 'transfer' = plain transfers to the treasuries (fallback). Unset: 'program' when TICKET_PROGRAM_ID is set, else 'transfer'. */
    PAYMENT_MODE: optional(z.enum(['program', 'transfer'])),
    TICKET_PROGRAM_ID: optional(z.string()),
    /** defaults for new pools' treasury variables, and the destinations in 'transfer' mode – PUBLIC keys */
    FEE_TREASURY: optional(z.string()),
    SEED_TREASURY: optional(z.string()),
    SOLANA_WS: optional(z.string()),
    SOLANA_RPC_FALLBACKS: z.string().default(''),
    SOLANA_COMMITMENT: z.enum(['confirmed', 'finalized']).default('confirmed'),
    WATCH_INTERVAL_MS: z.coerce.number().int().min(0).default(15_000), // 0 = the program watcher is off (tests)
    /** secrets: read through EnvService only, never through RulesConfig */
    WEBHOOK_SECRET: optional(z.string().min(16, 'WEBHOOK_SECRET must be at least 16 characters')),
    CRANK_SECRET: optional(z.string().min(32)), // base58 keypair that pays fees for the permissionless cranks (fail_pool, expire_pool, refund, close_pool of a refunded pool)
    CRANK_INTERVAL_MS: z.coerce.number().int().min(0).default(60_000), // the pool crank's schedule (needs CRANK_SECRET); 0 = only `pool:crank` from the CLI
    FEE_PAYER_SECRET: optional(z.string().min(32)), // base58 keypair of the gas sponsor – fee money only
    FEE_PAYER_MIN_SOL: z.coerce.number().min(0).default(0.05),
    SPONSOR_PER_WALLET_PER_DAY: z.coerce.number().int().min(0).default(20),
    PRIORITY_FEE_PERCENTILE: z.coerce.number().int().min(1).max(99).default(75),
    PRIORITY_FEE_MIN_MICROLAMPORTS: z.coerce.number().int().min(0).default(0), // 0 on devnet; 1000 on mainnet
    PRIORITY_FEE_MAX_MICROLAMPORTS: z.coerce.number().int().min(0).default(50_000),
    ORDER_TTL_MINUTES: z.coerce.number().int().positive().default(60),
    ONCHAIN_SESSION_TTL_HOURS: z.coerce.number().int().positive().max(168).default(24),
    /** wallets that may open the admin page (/admin.html + /api/admin/*), comma-separated; empty = no admin surface at all (every admin route is a 404) */
    ADMIN_WALLETS: z.string().default(''),
    /** the admin session's own signing key (rotate it = every admin signed out); unset = derived from JWT_SECRET */
    ADMIN_JWT_SECRET: optional(z.string().min(32, 'ADMIN_JWT_SECRET must be at least 32 characters')),
    /** how long an admin sign-in lasts (minutes); there is no silent renewal – the wallet signs again */
    ADMIN_SESSION_TTL_MINUTES: z.coerce.number().int().positive().max(1440).default(120),
    /** verified play: 'true' = the paid boards rank verified shifts only; 'false' = SHADOW mode – every ride is still judged and the verdict shown, but ranking ignores it */
    VERDICT_ENFORCE: z.enum(['true', 'false']).default('true').transform((v) => v === 'true'),
    /** days a ride's recording is kept after the ride ended (flagged rides are kept until reviewed); 0 = keep forever */
    TELEMETRY_RETENTION_DAYS: z.coerce.number().int().min(0).default(90),
    /** days the sign-in log (wallet, time, IP address, browser) is kept; 0 = forever */
    SIGNIN_RETENTION_DAYS: z.coerce.number().int().min(0).default(180),
    /** verified play: seconds of driving between two dispatch prompts ("flash your headlights"), issued with the heartbeat; a short shift gets at most 4; 0 = no prompts */
    CHALLENGE_INTERVAL_SECONDS: z.coerce.number().min(0).default(240),
    // live streams (spectators) – feature flags, enforced here and sent to the watch page / the driver's game (domain/live/live-features.ts)
    LIVE_CHAT: z.enum(['all', 'free', 'off']).default('all'), // spectators' chat: on every ride · only on free test rides · nowhere
    LIVE_DONATIONS: z.enum(['on', 'off']).default('on'), // any donation at all
    LIVE_FREE_DONATIONS: z.enum(['on', 'off']).default('on'), // on = MOCK donations (nothing charged) · off = a real SOL transfer to the driver, verified on chain
    LIVE_EFFECTS: z.enum(['all', 'free', 'off']).default('all'), // donations that change the ride (night / day / holes): every ride · free test rides only · none (tips only)
  })
  .superRefine((env, ctx) => {
    const badAdmin = env.ADMIN_WALLETS.split(',').map((w) => w.trim()).filter((w) => w.length > 0 && !isWalletAddress(w));
    if (badAdmin.length) ctx.addIssue({ code: 'custom', path: ['ADMIN_WALLETS'], message: `ADMIN_WALLETS must be base58 Solana addresses (bad: ${badAdmin.join(', ')})` });
    if (env.TREASURY_PUBKEY !== undefined && !isWalletAddress(env.TREASURY_PUBKEY)) {
      ctx.addIssue({ code: 'custom', path: ['TREASURY_PUBKEY'], message: 'TREASURY_PUBKEY must be a base58 Solana address' });
    }
    for (const key of ['TICKET_PROGRAM_ID', 'FEE_TREASURY', 'SEED_TREASURY'] as const) {
      const value = env[key];
      if (value !== undefined && !isWalletAddress(value)) ctx.addIssue({ code: 'custom', path: [key], message: `${key} must be a base58 Solana address` });
    }
    if (env.PRIORITY_FEE_MIN_MICROLAMPORTS > env.PRIORITY_FEE_MAX_MICROLAMPORTS) ctx.addIssue({ code: 'custom', path: ['PRIORITY_FEE_MIN_MICROLAMPORTS'], message: 'PRIORITY_FEE_MIN_MICROLAMPORTS must not exceed PRIORITY_FEE_MAX_MICROLAMPORTS' });
    if (env.PAYMENT_MODE === 'program' && !env.TICKET_PROGRAM_ID) ctx.addIssue({ code: 'custom', path: ['TICKET_PROGRAM_ID'], message: 'TICKET_PROGRAM_ID must be set when PAYMENT_MODE=program' });
    if (env.NODE_ENV === 'production') {
      if (!env.JWT_SECRET) ctx.addIssue({ code: 'custom', path: ['JWT_SECRET'], message: 'JWT_SECRET must be set in production' });
      if (!env.TREASURY_PUBKEY) ctx.addIssue({ code: 'custom', path: ['TREASURY_PUBKEY'], message: 'TREASURY_PUBKEY must be set in production' });
      // behind a reverse proxy req.ip is the proxy's: rate limits per IP would put every rider in one bucket. Make the deploy say how many hops to trust (0 = none).
      if (env.TRUST_PROXY === undefined) ctx.addIssue({ code: 'custom', path: ['TRUST_PROXY'], message: 'TRUST_PROXY must be set in production (number of reverse-proxy hops; 0 if none)' });
    }
  });

export type EnvConfig = z.infer<typeof envSchema>;

export function validateEnv(config: Record<string, unknown>): EnvConfig {
  const result = envSchema.safeParse(config);
  if (!result.success) {
    const details = result.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('\n');
    throw new Error(`Configuration validation error:\n${details}`);
  }
  return result.data;
}
