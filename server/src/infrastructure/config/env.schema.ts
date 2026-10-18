import { z } from 'zod';
import { isWalletAddress } from '../../domain/players/wallet-address.js';
import { isIpRule } from './ip-rules.js';

/** `KEY=` in a .env file arrives as an empty string – treat it as "not set". */
const optional = <T extends z.ZodTypeAny>(schema: T) => z.preprocess((v) => (v === '' ? undefined : v), schema.optional());

const MCP_HOSTS = new Set(['mcp', '127.0.0.1', 'localhost']);
const MCP_BLOCKED = new Set(['169.254.169.254', 'metadata.google.internal', '0.0.0.0']);
/** production EDITOR_MCP_URL: the internal MCP only, no userinfo, so the bearer and job token cannot be pointed at another host */
function mcpUrlIssue(raw: string): string | null {
  try {
    const u = new URL(raw);
    if ((u.protocol !== 'http:' && u.protocol !== 'https:') || u.username || u.password || MCP_BLOCKED.has(u.hostname) || !MCP_HOSTS.has(u.hostname)) {
      return 'EDITOR_MCP_URL in production must be http(s)://mcp, 127.0.0.1 or localhost, with no credentials';
    }
  } catch {
    return 'EDITOR_MCP_URL is not a URL';
  }
  return null;
}

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
    /** Split deployment (landing / game / api on sibling subdomains): the apex (e.g. freightchain.fun): the admin host (admin.<apex>) and the shared cookie of a NON-production split deployment derive from it – in production the player session is host-only on the API host (`__Host-fc_session`, audit H7-B) and the browser origins allowed to call the API with it. Unset = single origin. */
    COOKIE_DOMAIN: optional(z.string().regex(/^[a-z0-9.-]+$/i, 'COOKIE_DOMAIN must be a bare host name (no scheme, no port)')),
    CORS_ORIGINS: z.string().default(''),
    TRUST_PROXY: optional(z.coerce.number().int().min(0)),
    THROTTLE_LIMIT: z.coerce.number().int().positive().default(600),
    THROTTLE_AUTH_LIMIT: z.coerce.number().int().positive().default(30),
    THROTTLE_PROMO_LIMIT: z.coerce.number().int().positive().default(30),
    THROTTLE_ENTITIES_LIMIT: z.coerce.number().int().positive().default(120), // GET /api/entities/* per IP per minute (the game loads the bundle once per page)
    THROTTLE_EDITOR_LIMIT: z.coerce.number().int().positive().default(240), // /api/editor/* per editor wallet (else per IP) per minute
    THROTTLE_AUTH_RPS: z.coerce.number().int().positive().default(5), // /api/auth/* and /api/editor/auth/* per IP per second
    THROTTLE_ENTITIES_RPS: z.coerce.number().int().positive().default(5), // /api/entities/* per IP per second (nginx fc_entities is the same)
    THROTTLE_EDITOR_RPS: z.coerce.number().int().positive().default(10), // /api/editor/* per IP per second (nginx fc_editor is the same)
    THROTTLE_MCP_LIMIT: z.coerce.number().int().positive().default(600), // /api/editor/mcp/* per verified job per minute
    THROTTLE_MCP_RPS: z.coerce.number().int().positive().default(20), // /api/editor/mcp/* per verified job per second
    FREE_RIDE_SECONDS: z.coerce.number().positive().default(180),
    HB_MIN_INTERVAL_MS: z.coerce.number().int().min(0).default(1000),
    HB_TIMEOUT_MS: z.coerce.number().int().min(5000).default(150_000), // no heartbeat for this long = the tab is gone: off the live feed, its next heartbeat would fail it, the stale-ride sweeper ends it (failed · heartbeat lost)
    TREASURY_PUBKEY: optional(z.string()),
    SOLANA_RPC: z.string().min(1).default('https://api.devnet.solana.com'),
    SNS_RPC: z.string().min(1).default('https://api.mainnet-beta.solana.com'),
    SNS_RPC_FALLBACKS: z.string().default(''),
    SNS_CACHE_TTL_SECONDS: z.coerce.number().int().positive().default(86400),
    SNS_NEGATIVE_CACHE_TTL_SECONDS: z.coerce.number().int().positive().default(1800),
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
    // ---- paid tickets (docs/agents/escrow.md). Nothing here is required yet: today's deploy keeps booting; the workstreams add their own production checks.
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
    PAYOUT_SECRET: optional(z.string().min(32)), // base58 keypair named on chain as Config.payout_authority: pays prizes + closes a pool after its review window, nothing else
    PAYOUT_INTERVAL_MS: z.coerce.number().int().min(0).default(300_000), // the payout job's schedule (needs PAYOUT_SECRET); 0 = only `pool:payout` from the CLI
    ACHIEVEMENT_MINT_SECRET: optional(z.string().min(32)), // base58 keypair = tree creator + collection authority of the badge cNFTs (docs/agents/achievements.md); a mint-only key, never the crank or payout key
    HONK_PROGRAM_ID: optional(z.string()), // freightchain_honk program id. Unset = ledger burns only, no signature. Local validator: GctCYSHbCnHN8sE1LjUL9cmSpFd5mcVdfaumRcaVWZZx
    HONK_EMITTER_SECRET: optional(z.string().min(32)), // keypair that may mint_ride. The initialize payer. Unset = a verified ride stays on the ledger only
    ACHIEVEMENT_TREE: optional(z.string().min(32).max(44)), // the Bubblegum v2 Merkle tree (scripts/achievements/setup-tree.mjs prints it)
    ACHIEVEMENT_COLLECTION: optional(z.string().min(32).max(44)), // the MPL-Core collection (PermanentFreezeDelegate = soulbound, BubblegumV2)
    ACHIEVEMENT_MINT_INTERVAL_MS: z.coerce.number().int().min(0).default(120_000), // the mint job's schedule (needs the three keys above); 0 = only `achievement:mint` from the CLI
    ACHIEVEMENT_MINT_DELAY_MS: z.coerce.number().int().min(0).default(3_600_000), // an unlock waits this long before it is minted (a ride's verdict can still be re-judged meanwhile)
    ACHIEVEMENT_MINT_BATCH: z.coerce.number().int().min(1).max(100).default(10), // transactions per pass
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
    /** wallets that may use the 3D model editor on storybook.<apex> (/api/editor/*), comma-separated; empty = no editor (every editor route is a 404) */
    EDITOR_WALLETS: z.string().default(''),
    /** LOCAL ONLY: storybook skips the wallet sign-in and acts as the first EDITOR_WALLETS address. Refused in production. */
    EDITOR_OPEN: z.enum(['0', '1']).default('0'),
    /** the editor session's own signing key; unset = derived from JWT_SECRET (never the player's or the admin's bytes) */
    EDITOR_JWT_SECRET: optional(z.string().min(32, 'EDITOR_JWT_SECRET must be at least 32 characters')),
    /** how long an editor sign-in lasts (minutes); the wallet signs again after it */
    EDITOR_SESSION_TTL_MINUTES: z.coerce.number().int().positive().max(1440).default(240),
    /** optional: only these client IPs / CIDRs reach the editor (comma-separated, IPv4 or IPv6); empty = any IP */
    EDITOR_IP_ALLOWLIST: z.string().default(''),
    /** the AI model editor (docs/agents/editor.md): SECRETS, read by the infrastructure only – a provider is offered when its key is set */
    ANTHROPIC_API_KEY: optional(z.string().min(8)),
    OPENAI_API_KEY: optional(z.string().min(8)),
    GEMINI_API_KEY: optional(z.string().min(8)),
    ZAI_API_KEY: optional(z.string().min(8)),
    ZAI_BASE_URL: z.string().url().default('https://api.z.ai/api/paas/v4'), // z.ai's OpenAI-compatible endpoint (pay as you go); the GLM Coding Plan: https://api.z.ai/api/coding/paas/v4
    XAI_API_KEY: optional(z.string().min(8)),
    XAI_BASE_URL: z.string().url().default('https://api.x.ai/v1'), // xAI's OpenAI-compatible Responses API
    EDITOR_DEFAULT_PROVIDER: optional(z.enum(['xai', 'anthropic', 'openai', 'gemini', 'zai', 'fake'])), // unset / not enabled = the first enabled one
    EDITOR_MODEL_ANTHROPIC: optional(z.string().min(1).max(100)), // default claude-opus-5-5
    EDITOR_MODEL_OPENAI: optional(z.string().min(1).max(100)), // default gpt-6
    EDITOR_MODEL_GEMINI: optional(z.string().min(1).max(100)), // default gemini-3.1-pro-preview
    EDITOR_MODEL_ZAI: optional(z.string().min(1).max(100)), // default glm-5.2
    EDITOR_MODEL_XAI: optional(z.string().min(1).max(100)), // default grok-4.7
    EDITOR_MCP_URL: z.string().url().default('http://127.0.0.1:3100'), // the entity MCP (mcp/; prod compose: http://mcp:3100)
    EDITOR_MCP_TOKEN: optional(z.string().min(24, 'EDITOR_MCP_TOKEN must be at least 24 characters')), // shared with the mcp service; unset = no AI editor
    EDITOR_JOB_TIMEOUT_MS: z.coerce.number().int().min(10_000).max(3_600_000).default(600_000), // a job longer than this is aborted (and one left running past it by a restart is failed)
    EDITOR_FAKE_LLM: z.enum(['0', '1']).default('0'), // TEST ONLY: offer the scripted fake provider (refused in production)
    /** verified play: 'true' = the paid boards rank verified shifts only; 'false' = SHADOW mode – every ride is still judged and the verdict shown, but ranking ignores it */
    TRAFFIC_PROOF_REQUIRED: z.enum(['true', 'false']).default('true').transform(v => v === 'true'),
    VERDICT_ENFORCE: z.enum(['true', 'false']).default('true').transform((v) => v === 'true'),
    /** days a ride's recording is kept after the ride ended (flagged rides are kept until reviewed); 0 = keep forever */
    TELEMETRY_RETENTION_DAYS: z.coerce.number().int().min(0).default(90),
    /** days the sign-in log (wallet, time, IP address, browser) is kept; 0 = forever */
    SIGNIN_RETENTION_DAYS: z.coerce.number().int().min(0).default(180),
    /** verified play: seconds of driving between two challenges, issued with the heartbeat when CHALLENGE_KINDS is non-empty; a short shift gets at most 4; 0 = off */
    CHALLENGE_INTERVAL_SECONDS: z.coerce.number().min(0).default(240),
    CHALLENGE_FREE_RIDES: z.enum(['on', 'off']).default('on'), // dispatch prompts on FREE rides too – prod compose: off (the one-minute free run is the onboarding ride; it ends itself at the line, so its prompts could never be judged, and the free board ranks every completed run whatever its verdict)
    // live streams (spectators) – feature flags, enforced here and sent to the watch page / the driver's game (domain/live/live-features.ts)
    LIVE_CHAT: z.enum(['all', 'free', 'off']).default('all'), // spectators' chat: on every ride · only on free test rides · nowhere
    LIVE_DONATIONS: z.enum(['on', 'off']).default('on'), // any donation at all
    LIVE_FREE_DONATIONS: z.enum(['on', 'off']).default('on'), // on = MOCK donations (nothing charged) · off = a real SOL transfer to the driver, verified on chain
    LIVE_EFFECTS: z.enum(['all', 'free', 'off']).default('all'), // donations that change the ride (night / day / holes): every ride · free test rides only · none (tips only)
    /** comma-separated ISO codes that replace the prize-rules defaults. Empty = those defaults (sanctioned draft, UK+EU, blocked US states). */
    PRIZE_SANCTIONED_COUNTRIES: z.string().default(''),
    PRIZE_BLOCKED_COUNTRIES: z.string().default(''),
    PRIZE_BLOCKED_US_STATES: z.string().default(''),
  })
  .superRefine((env, ctx) => {
    const badAdmin = env.ADMIN_WALLETS.split(',').map((w) => w.trim()).filter((w) => w.length > 0 && !isWalletAddress(w));
    if (badAdmin.length) ctx.addIssue({ code: 'custom', path: ['ADMIN_WALLETS'], message: `ADMIN_WALLETS must be base58 Solana addresses (bad: ${badAdmin.join(', ')})` });
    const badEditor = env.EDITOR_WALLETS.split(',').map((w) => w.trim()).filter((w) => w.length > 0 && !isWalletAddress(w));
    if (badEditor.length) ctx.addIssue({ code: 'custom', path: ['EDITOR_WALLETS'], message: `EDITOR_WALLETS must be base58 Solana addresses (bad: ${badEditor.join(', ')})` });
    const badIps = env.EDITOR_IP_ALLOWLIST.split(',').map((w) => w.trim()).filter((w) => w.length > 0 && !isIpRule(w));
    if (badIps.length) ctx.addIssue({ code: 'custom', path: ['EDITOR_IP_ALLOWLIST'], message: `EDITOR_IP_ALLOWLIST must be IPs or CIDRs (bad: ${badIps.join(', ')})` });
    if (env.TREASURY_PUBKEY !== undefined && !isWalletAddress(env.TREASURY_PUBKEY)) {
      ctx.addIssue({ code: 'custom', path: ['TREASURY_PUBKEY'], message: 'TREASURY_PUBKEY must be a base58 Solana address' });
    }
    for (const key of ['TICKET_PROGRAM_ID', 'FEE_TREASURY', 'SEED_TREASURY', 'HONK_PROGRAM_ID'] as const) {
      const value = env[key];
      if (value !== undefined && !isWalletAddress(value)) ctx.addIssue({ code: 'custom', path: [key], message: `${key} must be a base58 Solana address` });
    }
    if (env.PRIORITY_FEE_MIN_MICROLAMPORTS > env.PRIORITY_FEE_MAX_MICROLAMPORTS) ctx.addIssue({ code: 'custom', path: ['PRIORITY_FEE_MIN_MICROLAMPORTS'], message: 'PRIORITY_FEE_MIN_MICROLAMPORTS must not exceed PRIORITY_FEE_MAX_MICROLAMPORTS' });
    for (const key of ['PRIZE_SANCTIONED_COUNTRIES', 'PRIZE_BLOCKED_COUNTRIES', 'PRIZE_BLOCKED_US_STATES'] as const) {
      const raw = env[key].trim();
      if (!raw) continue;
      const bad = raw.split(',').map((s) => s.trim()).filter((s) => !/^[A-Za-z]{2}$/.test(s));
      if (bad.length) ctx.addIssue({ code: 'custom', path: [key], message: `${key} must be comma-separated 2-letter codes` });
    }
    if (env.PAYMENT_MODE === 'program' && !env.TICKET_PROGRAM_ID) ctx.addIssue({ code: 'custom', path: ['TICKET_PROGRAM_ID'], message: 'TICKET_PROGRAM_ID must be set when PAYMENT_MODE=program' });
    if (env.NODE_ENV === 'production') {
      if (env.EDITOR_FAKE_LLM === '1') ctx.addIssue({ code: 'custom', path: ['EDITOR_FAKE_LLM'], message: 'EDITOR_FAKE_LLM is a test switch – never in production' });
      if (env.EDITOR_OPEN === '1') ctx.addIssue({ code: 'custom', path: ['EDITOR_OPEN'], message: 'EDITOR_OPEN is a local switch – never in production' });
      // without it the admin / storybook host walls switch off (they answer on any host, like localhost) – never with wallets that may sign in there
      if (!env.COOKIE_DOMAIN && (env.EDITOR_WALLETS.trim() || env.ADMIN_WALLETS.trim())) ctx.addIssue({ code: 'custom', path: ['COOKIE_DOMAIN'], message: 'COOKIE_DOMAIN must be set in production when ADMIN_WALLETS or EDITOR_WALLETS is (the admin and storybook host checks need it)' });
      if (!env.JWT_SECRET) ctx.addIssue({ code: 'custom', path: ['JWT_SECRET'], message: 'JWT_SECRET must be set in production' });
      if (!env.TREASURY_PUBKEY) ctx.addIssue({ code: 'custom', path: ['TREASURY_PUBKEY'], message: 'TREASURY_PUBKEY must be set in production' });
      // behind a reverse proxy req.ip is the proxy's: rate limits per IP would put every rider in one bucket. Make the deploy say how many hops to trust (0 = none).
      if (env.TRUST_PROXY === undefined) ctx.addIssue({ code: 'custom', path: ['TRUST_PROXY'], message: 'TRUST_PROXY must be set in production (number of reverse-proxy hops; 0 if none)' });
      if (env.EDITOR_MCP_TOKEN) {
        if (!env.REDIS_URL) ctx.addIssue({ code: 'custom', path: ['REDIS_URL'], message: 'REDIS_URL is required for the production AI editor rate limits' });
        const mcp = mcpUrlIssue(env.EDITOR_MCP_URL);
        if (mcp) ctx.addIssue({ code: 'custom', path: ['EDITOR_MCP_URL'], message: mcp });
      }
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
