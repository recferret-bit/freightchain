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
  })
  .superRefine((env, ctx) => {
    const badAdmin = env.ADMIN_WALLETS.split(',').map((w) => w.trim()).filter((w) => w.length > 0 && !isWalletAddress(w));
    if (badAdmin.length) ctx.addIssue({ code: 'custom', path: ['ADMIN_WALLETS'], message: `ADMIN_WALLETS must be base58 Solana addresses (bad: ${badAdmin.join(', ')})` });
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
