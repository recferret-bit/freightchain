import { fileURLToPath } from 'node:url';
try { process.loadEnvFile('.env'); } catch { /* no .env – plain environment */ }   // before `config` reads process.env (a stable JWT_SECRET keeps you signed in across --watch restarts)

/* Server tunables. The game constants are mirrored from client/js/config.js (MAX_SPEED, COMPLETE_DIST_K) – keep them in step. */
const num = (v: string | undefined, d: number) => (v !== undefined && v !== '' && Number.isFinite(+v) ? +v : d);

export const MAX_SPEED = 28;          // m/s, the game's governor (CFG.MAX_SPEED)
export const COMPLETE_DIST_K = 0.5;   // CFG.COMPLETE_DIST_K: complete = minSeconds driven AND K × MAX_SPEED × minSeconds metres

export const config = {
  port: num(process.env.PORT, 3000),
  production: process.env.NODE_ENV === 'production',
  domain: process.env.APP_DOMAIN ?? 'localhost:3000',   // shown in the sign-in message; set it to the real host when deployed
  origin: process.env.APP_ORIGIN ?? 'http://localhost:3000',
  clientDir: process.env.CLIENT_DIR ?? fileURLToPath(new URL('../../client', import.meta.url)),   // src/ and dist/ both sit one level under server/
  dbPath: process.env.DB_PATH ?? 'data/freightchain.sqlite',
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

export const completeDist = (minSeconds: number) => COMPLETE_DIST_K * MAX_SPEED * minSeconds;
