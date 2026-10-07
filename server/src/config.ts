import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import bs58 from 'bs58';
try { process.loadEnvFile('.env'); } catch { /* no .env – plain environment */ }   // before `config` reads process.env (a stable JWT_SECRET keeps you signed in across --watch restarts)

/* Server tunables. The game constants are mirrored from client/js/config.js (MAX_SPEED, COMPLETE_DIST_K) – keep them in step. */
const num = (v: string | undefined, d: number) => (v !== undefined && v !== '' && Number.isFinite(+v) ? +v : d);

export const MAX_SPEED = 28;          // m/s, the game's governor (CFG.MAX_SPEED)
export const COMPLETE_DIST_K = 0.5;   // CFG.COMPLETE_DIST_K: complete = minSeconds driven AND K × MAX_SPEED × minSeconds metres

const dbPath = process.env.DB_PATH ?? 'data/freightchain.sqlite';
/* Treasury = where entry fees go. Receiving needs only the PUBLIC key: the server never holds the secret (no payouts yet). Dev: `npm run treasury:init`
   writes data/treasury.json (gitignored). Production must set TREASURY_PUBKEY. */
function treasury(): string {
  let key = process.env.TREASURY_PUBKEY ?? '';
  if (!key && dbPath !== ':memory:') { try { key = (JSON.parse(readFileSync(join(dirname(dbPath), 'treasury.json'), 'utf8')) as { publicKey?: string }).publicKey ?? ''; } catch { /* none yet */ } }
  if (key) { let ok = false; try { ok = bs58.decode(key).length === 32; } catch { /* not base58 */ } if (!ok) throw new Error('TREASURY_PUBKEY is not a base58 Solana address'); }
  if (!key && process.env.NODE_ENV === 'production') throw new Error('TREASURY_PUBKEY must be set in production');
  return key;
}

export const config = {
  port: num(process.env.PORT, 3000),
  production: process.env.NODE_ENV === 'production',
  domain: process.env.APP_DOMAIN ?? 'localhost:3000',   // shown in the sign-in message; set it to the real host when deployed
  origin: process.env.APP_ORIGIN ?? 'http://localhost:3000',
  clientDir: process.env.CLIENT_DIR ?? fileURLToPath(new URL('../../client', import.meta.url)),   // src/ and dist/ both sit one level under server/
  dbPath,
  treasury: treasury(),                 // '' = paid rides disabled (503)
  solRpc: process.env.SOLANA_RPC ?? 'https://api.devnet.solana.com',
  solUsdFixed: num(process.env.SOL_USD, 0),   // > 0 pins the price (tests / offline demo)
  quoteTtlMs: 10 * 60_000,              // how long a ride's price is held for the buyer; only stops NEW payment transactions – a matching payment is honoured after it
  demoWallets: new Set((process.env.DEMO_WALLETS ?? '').split(',').map(w => w.trim()).filter(Boolean)),   // '*' = every wallet
  demoScale: num(process.env.DEMO_SCALE, 60),   // paid shift length ÷ this for demo wallets (the speed bound is NOT scaled)
  initialSeedLamports: Math.round(num(process.env.INITIAL_SEED_SOL, 0) * 1e9),   // the very first round's "next ride start" money
  jwtSecret: process.env.JWT_SECRET ?? '',
  nonceTtlMs: 5 * 60_000,
  sessionDays: 7,
  freeOnSignup: 5,                      // free rides at registration, then +1 per UTC day (lazily, see UsersService.touch)
  freeRideSeconds: num(process.env.FREE_RIDE_SECONDS, 180),   // env is for tests / demo only
  hbMinIntervalMs: num(process.env.HB_MIN_INTERVAL_MS, 1000),
  hbTimeoutMs: 150_000,                 // background tabs throttle timers to ~1/min, so be generous; the game pauses (and keeps beating) when hidden
  speedSlack: 1.2,                      // Δs may be up to MAX_SPEED·Δt·slack + slackMetres
  slackMetres: 20,
};

/* Ride tiers. Paid lengths are the production values; `usd` is the face price, charged in SOL at the quoted rate. */
export const TIERS = {
  free: { seconds: config.freeRideSeconds, usd: 0 },
  '1h': { seconds: 3600, usd: 5 },
  '4h': { seconds: 4 * 3600, usd: 15 },
  '8h': { seconds: 8 * 3600, usd: 50 },
} as const;
export type TierId = keyof typeof TIERS;
export const isTier = (t: unknown): t is TierId => typeof t === 'string' && Object.hasOwn(TIERS, t);

/* The prize split of every paid entry (floors; the remainder goes to fees so the shares always sum to the entries). */
export const SPLIT = { grand: 0.5, nextSeed: 0.2, top20: 0.2 } as const;   // fees = the rest (10 %)

export const completeDist = (minSeconds: number) => COMPLETE_DIST_K * MAX_SPEED * minSeconds;
