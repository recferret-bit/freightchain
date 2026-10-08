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
    FREE_RIDE_SECONDS: z.coerce.number().positive().default(180),
    HB_MIN_INTERVAL_MS: z.coerce.number().int().min(0).default(1000),
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
  })
  .superRefine((env, ctx) => {
    if (env.TREASURY_PUBKEY !== undefined && !isWalletAddress(env.TREASURY_PUBKEY)) {
      ctx.addIssue({ code: 'custom', path: ['TREASURY_PUBKEY'], message: 'TREASURY_PUBKEY must be a base58 Solana address' });
    }
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
