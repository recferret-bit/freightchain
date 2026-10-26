import type { VerdictReason } from './verdict.dto.js';

/*
 * POOL-LEVEL ATTENTION MARKS – "something looks strange" across the rides of ONE prize pool, which no single recording can show. They are NOT verdict
 * rules (verdict-rules.ts / RideVerdict.judge judge one recording and carry RULES_VERSION): a mark is a `flag` reason with a `pool-` code appended to the
 * verdict of each of the wallet's completed rides in that pool, so the ride stays UNDER REVIEW until an admin decides (ride-review.ts). They never
 * reject and never touch an admin's decision. Computed by PoolAttentionService.markPool(poolId) (CLI `pool:attention --pool N`, and before a payout).
 *
 * The ranking is the pool's: total distance of a wallet's completed rides in the pool (ties: more rides, the earlier first finish, the wallet) – the
 * same order as RideQueryPort.poolRanking – over every completed ride except those an admin REJECTED (decided out of the ranking).
 *   pool-distance-outlier  a wallet's total is more than OUTLIER_K (1.5) × the median total of the top POOL_TOP (20) – only when at least
 *                          OUTLIER_MIN_WALLETS (4) wallets rank (a median of two or three says nothing). Speed is governed (28 m/s), so a far larger
 *                          total means many more tickets driven or a recording worth a look; the admin compares it with the wallet's rides.
 *   pool-shared-ip         two different wallets in the top 20 share a sign-in subnet HMAC (player.SignIn – kept SIGNIN_RETENTION_DAYS) – one person with
 *                          several wallets, or a shared network (a family, a café, a mobile carrier's NAT): the admin decides which.
 *   pool-new-wallet-top3   a top-3 wallet first seen (the earliest of Player.createdAt and its first kept sign-in) less than NEW_WALLET_HOURS (24) h
 *                          before its first ride in this pool.
 *   pool-duplicate-recording  (on the LATER ride of a pair only) two rides of the pool whose recordings hold the same line across the road – within
 *                          DUPLICATE_D_METRES on DUPLICATE_SHARE of at least DUPLICATE_MIN_COMMON shared PRINT_METRES steps (batch-summary.ts `print`): every
 *                          rider of a pool drives the same road, and the public replay (GET /api/watch/:id) hands out every sample – a copy re-hashed under
 *                          another ride id passes every per-recording check (audit H2). The earlier upload is the original.
 * Marks are APPEND-ONLY: a later run whose median moved does not take an earlier mark back – the admin's decision does. The details are shown to the
 * rider (GET /api/rides/:id carries the reasons), so they never name an IP address, another wallet or a sign-in time.
 */
export const POOL_MARK_PREFIX = 'pool-';
export const POOL_TOP = 20;
export const OUTLIER_K = 1.5;
export const OUTLIER_MIN_WALLETS = 4;
export const NEW_WALLET_TOP = 3;
export const NEW_WALLET_HOURS = 24;
export const DUPLICATE_D_METRES = 0.1;
export const DUPLICATE_SHARE = 0.9;
export const DUPLICATE_MIN_COMMON = 40;   // × PRINT_METRES (25 m) = 1 km of shared road

export const isPoolMark = (code: string): boolean => code.startsWith(POOL_MARK_PREFIX);

/** one completed ride paid with a ticket of the pool, with its verdict status (null = not judged) */
export interface PoolRideFacts {
  rideId: string;
  wallet: string;
  /** metres (Ride.lastS) */
  distance: number;
  driveSeconds: number;
  startedAt: Date | null;
  endedAt: Date | null;
  verdict: string | null;
  /** an admin decided the verdict by hand */
  overridden: boolean;
}

/** what the sign-in log says about a wallet: when it was first seen and every IP it signed in from */
export interface WalletSignIns {
  wallet: string;
  firstSeen: Date | null;
  ips: readonly string[];
}

export interface PoolStanding {
  wallet: string;
  /** 1-based */
  rank: number;
  distance: number;
  rides: number;
}

export interface PoolAttentionMark {
  rideId: string;
  wallet: string;
  reasons: VerdictReason[];
}

const decidedOut = (r: PoolRideFacts) => r.overridden && r.verdict === 'rejected';

/** The pool's ranking from its completed rides (an admin-rejected ride does not count), best first. */
export function poolStandings(rides: readonly PoolRideFacts[]): PoolStanding[] {
  const groups = new Map<string, { distance: number; rides: number; first: number }>();
  for (const r of rides) {
    if (decidedOut(r)) continue;
    const g = groups.get(r.wallet) ?? { distance: 0, rides: 0, first: Number.POSITIVE_INFINITY };
    g.distance += r.distance; g.rides += 1; g.first = Math.min(g.first, r.endedAt?.getTime() ?? Number.POSITIVE_INFINITY);
    groups.set(r.wallet, g);
  }
  return [...groups.entries()]
    .sort(([wa, a], [wb, b]) => b.distance - a.distance || b.rides - a.rides || a.first - b.first || (wa < wb ? -1 : wa > wb ? 1 : 0))
    .map(([wallet, g], i) => ({ wallet, rank: i + 1, distance: g.distance, rides: g.rides }));
}

const median = (xs: readonly number[]): number => {
  const s = [...xs].sort((a, b) => a - b), mid = Math.floor(s.length / 2);
  return s.length % 2 ? (s[mid] as number) : ((s[mid - 1] as number) + (s[mid] as number)) / 2;
};
const km = (m: number) => (m / 1000).toFixed(1);

/** The marks per wallet of the top POOL_TOP (wallet → reasons). Pure. */
export function walletMarks(poolId: number, rides: readonly PoolRideFacts[], signIns: readonly WalletSignIns[]): Map<string, VerdictReason[]> {
  const top = poolStandings(rides).slice(0, POOL_TOP);
  const marks = new Map<string, VerdictReason[]>();
  const add = (wallet: string, code: string, detail: string) => {
    const list = marks.get(wallet) ?? [], full = `${POOL_MARK_PREFIX}${code}`;
    if (!list.some((r) => r.code === full)) list.push({ code: full, detail, severity: 'flag' });
    marks.set(wallet, list);
  };

  if (top.length >= OUTLIER_MIN_WALLETS) {
    const m = median(top.map((s) => s.distance));
    for (const s of top) if (s.distance > OUTLIER_K * m) add(s.wallet, 'distance-outlier', `drove ${km(s.distance)} km in pool ${poolId} – more than ${OUTLIER_K}× the median of its top ${POOL_TOP} (${km(m)} km)`);
  }

  const ranked = new Set(top.map((s) => s.wallet)), byIp = new Map<string, Set<string>>();
  for (const s of signIns) if (ranked.has(s.wallet)) for (const ip of s.ips) byIp.set(ip, (byIp.get(ip) ?? new Set()).add(s.wallet));
  const shared = new Set([...byIp.values()].filter((ws) => ws.size >= 2).flatMap((ws) => [...ws]));
  for (const s of top) if (shared.has(s.wallet)) add(s.wallet, 'shared-ip', `signed in from the same network subnet as another wallet in the top ${POOL_TOP} of pool ${poolId}`);

  const seen = new Map(signIns.map((s) => [s.wallet, s.firstSeen]));
  for (const s of top.slice(0, NEW_WALLET_TOP)) {
    const firstSeen = seen.get(s.wallet);
    const starts = rides.filter((r) => r.wallet === s.wallet && !decidedOut(r)).map((r) => (r.startedAt ?? r.endedAt)?.getTime() ?? Number.POSITIVE_INFINITY);
    const firstRide = Math.min(...starts);
    if (firstSeen && Number.isFinite(firstRide) && firstRide - firstSeen.getTime() < NEW_WALLET_HOURS * 3_600_000) {
      add(s.wallet, 'new-wallet-top3', `in the top ${NEW_WALLET_TOP} of pool ${poolId} with a wallet first seen less than ${NEW_WALLET_HOURS} h before its first ride in that pool`);
    }
  }
  return marks;
}

/** a ride's fingerprint (batch-summary.ts `print`, every batch's merged) and when its first batch arrived */
export interface RidePrint {
  rideId: string;
  wallet: string;
  /** ms */
  firstAt: number;
  /** s ÷ PRINT_METRES → d */
  print: ReadonlyMap<number, number>;
}

/** How alike two fingerprints are: the shared road steps and the share of them where the two lines lie within DUPLICATE_D_METRES. */
export function printMatch(a: ReadonlyMap<number, number>, b: ReadonlyMap<number, number>): { common: number; share: number } {
  let common = 0, same = 0;
  for (const [k, d] of a) { const e = b.get(k); if (e === undefined) continue; common++; if (Math.abs(d - e) <= DUPLICATE_D_METRES) same++; }
  return { common, share: common ? same / common : 0 };
}

/** Copied recordings among the rides of DIFFERENT wallets: for each pair that matches, the later one (by its first batch) – the earlier is the original. Pure. */
export function duplicateRecordings(poolId: number, prints: readonly RidePrint[]): PoolAttentionMark[] {
  const out = new Map<string, PoolAttentionMark>();
  for (let i = 0; i < prints.length; i++) {
    for (let j = i + 1; j < prints.length; j++) {
      const a = prints[i] as RidePrint, b = prints[j] as RidePrint;
      if (a.wallet === b.wallet) continue;
      const m = printMatch(a.print, b.print);
      if (m.common < DUPLICATE_MIN_COMMON || m.share < DUPLICATE_SHARE) continue;
      const copy = a.firstAt <= b.firstAt ? b : a;
      out.set(copy.rideId, { rideId: copy.rideId, wallet: copy.wallet, reasons: [{ code: `${POOL_MARK_PREFIX}duplicate-recording`, severity: 'flag',
        detail: `its recording holds the same line as an earlier ride of pool ${poolId} on ${Math.round(m.share * 100)} % of ${(m.common * 25 / 1000).toFixed(1)} km – a copied recording?` }] });
    }
  }
  return [...out.values()];
}

/** The marks per RIDE: every completed ride of a marked wallet in the pool except one an admin REJECTED (out of the ranking already). A ride an admin
    ACCEPTED is listed too – whoever writes the marks skips it under the rider's lock (VerdictService.addAttention), which is where an admin's decision
    is authoritative (it may land between this read and that lock). Pure. */
export function poolAttention(poolId: number, rides: readonly PoolRideFacts[], signIns: readonly WalletSignIns[], prints: readonly RidePrint[] = []): PoolAttentionMark[] {
  const byWallet = walletMarks(poolId, rides, signIns);
  const marks = rides.filter((r) => !decidedOut(r) && byWallet.has(r.wallet)).map((r) => ({ rideId: r.rideId, wallet: r.wallet, reasons: byWallet.get(r.wallet) ?? [] }));
  const live = new Set(rides.filter((r) => !decidedOut(r)).map((r) => r.rideId));
  for (const d of duplicateRecordings(poolId, prints.filter((p) => live.has(p.rideId)))) {
    const at = marks.find((m) => m.rideId === d.rideId);
    if (at) at.reasons = [...at.reasons, ...d.reasons]; else marks.push(d);
  }
  return marks;
}
