#!/usr/bin/env node
/* RIDE REVIEW – what needs an admin's eyes? (the `ride-review` skill: .claude/skills/ride-review)
   Lists every completed PAID ride that is UNDER REVIEW (src/domain/verdict/ride-review.ts: flagged, rejected by the machine checks, pending or never
   judged – and no admin decision yet), per pool, with its rank in the pool, its distance, its verdict reasons (incl. the pool-* attention marks on record)
   and the pool-* marks `pool:attention` WOULD add now (src/domain/verdict/pool-attention.ts, computed here from the same rows – nothing is written). An
   ACCEPTED ride that the pool check would mark is listed too: after `pool:attention` it is under review. Then each listed ride is audited from scratch
   by the ride-audit tool (scripts/ride-audit.mjs --json: road rebuilt from the seed, every batch re-hashed, every sample re-measured) and its OK / NOT OK
   is printed beside it. It NEVER changes a verdict: the admin decides on the admin page (ACCEPT / REJECT, signed).

     node scripts/ride-review.mjs [--pool N] [--prod] [--db URL] [--no-audit] [--limit N] [--json]
     sources: --prod (production via `npm run ops -- sql`, read-only) · --db URL · default DATABASE_URL, else server/.env (ENV_FILE=… for another file)

   Needs a build of the server: AUDIT_BUILD=<dir> (default dist; .claude/skills/ride-review/run.sh builds a private copy). Exit: 0 nothing waits for an
   admin (the pool is ready as far as review goes) · 1 at least one ride is (or would be) under review · 2 usage / loading error. */
import { spawnSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url)), SERVER = resolve(HERE, '..'), ROOT = resolve(SERVER, '..');
const BUILD = resolve(SERVER, process.env.AUDIT_BUILD ?? 'dist');
const args = process.argv.slice(2), flag = (f) => args.includes(f), opt = (f) => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : undefined; };
const die = (msg) => { console.error(`ride-review: ${msg}`); process.exit(2); };
if (!existsSync(join(BUILD, 'domain/verdict/ride-review.js'))) die(`no server build at ${BUILD} – run .claude/skills/ride-review/run.sh (it builds one), or npm run server:build`);

const { reviewOf } = await import(join(BUILD, 'domain/verdict/ride-review.js'));
const { walletMarks, poolStandings, POOL_TOP, isPoolMark } = await import(join(BUILD, 'domain/verdict/pool-attention.js'));

const WALLET = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const pool = opt('--pool'), limit = Number(opt('--limit') ?? 50);
if (pool !== undefined && !/^\d{1,10}$/.test(pool)) die('--pool takes a pool id (a whole number)');
if (!Number.isInteger(limit) || limit < 0 || limit > 500) die('--limit takes 0..500 (the number of rides to audit)');

/* ───────── where the rows come from (the same read-only access as scripts/ride-audit.mjs) ───────── */
function databaseUrl() {
  if (opt('--db')) return opt('--db');
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  const file = resolve(SERVER, process.env.ENV_FILE ?? '.env');
  if (!existsSync(file)) die('no database: give --db URL, set DATABASE_URL, or create server/.env');
  const line = readFileSync(file, 'utf8').split('\n').find((l) => l.startsWith('DATABASE_URL='));   // the value is used, never printed
  if (!line) die(`${file} has no DATABASE_URL`);
  return line.slice('DATABASE_URL='.length).replace(/^["']|["']$/g, '');
}
let prisma = null;
async function sql(text) {
  if (flag('--prod')) {
    const r = spawnSync('bash', [join(ROOT, 'deploy/scripts/ops.sh'), 'sql'], { input: `\\pset format unaligned\n\\pset tuples_only on\n${text}\n`, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
    if (r.status !== 0) die(`production query failed: ${(r.stderr || r.stdout).trim().split('\n').slice(-3).join(' · ')}`);
    return r.stdout.split('\n').map((l) => l.trim()).filter(Boolean);
  }
  if (!prisma) { const { PrismaClient } = await import('@prisma/client'); prisma = new PrismaClient({ datasources: { db: { url: databaseUrl() } } }); }
  return (await prisma.$transaction(async (tx) => { await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY'); return tx.$queryRawUnsafe(text); })).map((row) => String(Object.values(row)[0]));
}
const json = async (text) => { const lines = await sql(text); return lines.length ? JSON.parse(lines.join('\n')) : []; };   // psql may wrap a long json value over lines
const date = (v) => (v == null ? null : new Date(/[zZ]|[+-]\d\d:?\d\d$/.test(v) ? v : `${v}Z`));   // timestamp(3) columns carry no zone: they are UTC

/* every completed PAID ride (of one pool, or all) with its verdict – the review and the pool rankings both come from these rows */
const ridesSql = `SELECT coalesce(jsonb_agg(x ORDER BY x."poolId" NULLS LAST, x."endedAt"), '[]'::jsonb)::text FROM (   -- jsonb: json_agg of rows puts a newline between them
  SELECT r.id, r.wallet, r.tier, r.status, r."poolId", r."lastS", r."driveSeconds", r."startedAt", r."endedAt", v.status AS verdict, v.reasons, v."overriddenBy"
  FROM ride."Ride" r LEFT JOIN verdict."RideVerdict" v ON v."rideId" = r.id
  WHERE r.status = 'completed' AND r.tier <> 'free'${pool !== undefined ? ` AND r."poolId" = ${Number(pool)}` : ''}) x`;
const signInsSql = (wallets) => `SELECT coalesce(json_agg(json_build_object('wallet', p.wallet, 'createdAt', p."createdAt",
    'firstAt', (SELECT min(s.at) FROM player."SignIn" s WHERE s.wallet = p.wallet),
    'ips', (SELECT coalesce(json_agg(DISTINCT s.ip), '[]'::json) FROM player."SignIn" s WHERE s.wallet = p.wallet AND s.ip IS NOT NULL))), '[]'::json)::text
  FROM player."Player" p WHERE p.wallet IN (${wallets.map((w) => `'${w}'`).join(', ')})`;

/* ───────── the review ───────── */
async function main() {
  const rows = (await json(ridesSql)).map((r) => ({ ...r, startedAt: date(r.startedAt), endedAt: date(r.endedAt), reasons: r.reasons ?? [], overridden: r.overriddenBy != null }));
  const byPool = new Map();
  for (const r of rows) if (r.poolId != null) byPool.set(r.poolId, [...(byPool.get(r.poolId) ?? []), r]);

  const out = [];
  for (const [poolId, list] of [...byPool.entries(), ...(rows.some((r) => r.poolId == null) ? [[null, rows.filter((r) => r.poolId == null)]] : [])]) {
    let ranks = new Map(), wouldMark = new Map();
    if (poolId != null) {
      const facts = list.map((r) => ({ rideId: r.id, wallet: r.wallet, distance: r.lastS, driveSeconds: r.driveSeconds, startedAt: r.startedAt, endedAt: r.endedAt, verdict: r.verdict, overridden: r.overridden }));
      const standings = poolStandings(facts);
      ranks = new Map(standings.map((s) => [s.wallet, s.rank]));
      const top = standings.slice(0, POOL_TOP).map((s) => s.wallet).filter((w) => WALLET.test(w));
      const seen = top.length ? (await json(signInsSql(top))).map((s) => {
        const created = date(s.createdAt), first = date(s.firstAt);
        return { wallet: s.wallet, firstSeen: created && first ? (created < first ? created : first) : (created ?? first), ips: s.ips ?? [] };
      }) : [];
      wouldMark = walletMarks(poolId, facts, seen);
    }
    for (const r of list) {
      const review = reviewOf(r.tier, r.verdict === null ? null : { status: r.verdict, overridden: r.overridden }, r.status);
      const pending = r.overridden ? [] : (wouldMark.get(r.wallet) ?? []).filter((m) => !r.reasons.some((x) => x.code === m.code));
      if (review !== 'under_review' && !pending.length) continue;
      out.push({ id: r.id, wallet: r.wallet, tier: r.tier, poolId, rank: ranks.get(r.wallet) ?? null, distance: r.lastS, driveSeconds: r.driveSeconds, endedAt: r.endedAt,
        verdict: r.verdict, review, reasons: r.reasons, pending: pending.map((m) => m.code), audit: null });
    }
  }

  out.sort((a, b) => (a.poolId ?? Infinity) - (b.poolId ?? Infinity) || (a.rank ?? Infinity) - (b.rank ?? Infinity));   // pool by pool, best ranked first
  for (const r of out.slice(0, limit)) {
    if (flag('--no-audit')) break;
    const a = spawnSync(process.execPath, [join(HERE, 'ride-audit.mjs'), r.id, '--json', ...(flag('--prod') ? ['--prod'] : []), ...(opt('--db') ? ['--db', opt('--db')] : [])],
      { cwd: SERVER, encoding: 'utf8', env: { ...process.env, AUDIT_BUILD: process.env.AUDIT_BUILD ?? 'dist' }, maxBuffer: 256 * 1024 * 1024 });
    try { const rep = JSON.parse(a.stdout); r.audit = { ok: rep.ok, status: rep.verdict.status, reasons: rep.verdict.reasons.map((x) => x.code), ignoredHoles: rep.road.holes.filter((h) => h.outcome === 'ignored').length }; }
    catch { r.audit = { ok: null, error: (a.stderr || a.stdout || '').trim().split('\n').slice(-1)[0] }; }
  }

  if (flag('--json')) console.log(JSON.stringify(out, null, 2));
  else print(out);
  return out.length ? 1 : 0;
}

/* ───────── printing ───────── */
const km = (m) => `${(m / 1000).toFixed(2)} km`, pad = (s, n) => String(s).padEnd(n);
function print(out) {
  const where = `${flag('--prod') ? 'PRODUCTION (read-only)' : 'local database'}${pool !== undefined ? ` · pool ${pool}` : ' · all pools'}`;
  if (!out.length) { console.log(`ride review – ${where}: nothing waits for an admin. Every completed paid ride is ACCEPTED or decided, and pool:attention would mark nothing.`); return; }
  console.log(`ride review – ${where}: ${out.length} paid ride${out.length > 1 ? 's' : ''} need${out.length > 1 ? '' : 's'} an admin's eyes\n`);
  let last;
  for (const r of out) {
    if (r.poolId !== last) { console.log(r.poolId == null ? 'NO POOL (legacy pay-per-ride)' : `POOL ${r.poolId}`); last = r.poolId; }
    const now = r.review === 'under_review' ? 'UNDER REVIEW' : 'ACCEPTED now – pool:attention would put it UNDER REVIEW';
    console.log(`  ${r.rank ? `#${pad(r.rank, 3)}` : '    '} ${r.id}  ${r.wallet}  ${r.tier}  ${pad(km(r.distance), 10)} ${Math.round(r.driveSeconds)} s  ${now}`);
    console.log(`        verdict ${r.verdict ?? 'NOT JUDGED'}${r.reasons.length ? ` – ${r.reasons.map((x) => `${isPoolMark(x.code) ? '◆ ' : ''}${x.code}${x.severity === 'reject' ? ' (reject)' : ''}`).join(', ')}` : ''}`);
    for (const x of r.reasons) console.log(`          · ${x.code}: ${x.detail}`);
    if (r.pending.length) console.log(`        pool:attention would add: ${r.pending.join(', ')}  (writing them is the CLI: cd server && node dist/cli/index.js pool:attention --pool ${r.poolId} – it WRITES; on production only on the user's go)`);
    if (r.audit) console.log(`        audit   ${r.audit.ok === true ? 'OK' : r.audit.ok === false ? 'NOT OK' : 'could not run'}${r.audit.status ? ` – judged now: ${r.audit.status}${r.audit.reasons.length ? ` (${r.audit.reasons.join(', ')})` : ''}${r.audit.ignoredHoles ? ` · ${r.audit.ignoredHoles} hole(s) IGNORED` : ''}` : ` – ${r.audit.error}`}`);
    console.log(`        details: bash .claude/skills/ride-audit/run.sh ${r.id}${flag('--prod') ? ' --prod' : ''} · admin page #ride/${r.id}`);
  }
  console.log(`\nHow to decide (admin page → REVIEW QUEUE${pool !== undefined ? ` ?pool=${pool}` : ''} → the ride → ACCEPT · VERIFIED or REJECT, signed by the admin wallet):
  - audit OK and only flag reasons (gaps, timing, ◆ pool-* marks): look at the replay (play.html?watch=<id>) and the sign-ins; ACCEPT when it is a person driving.
  - audit NOT OK with reject reasons (no-recording, obstacle-ignored, hash-mismatch, teleport…): REJECT – the recording does not hold up.
  - ◆ pool-shared-ip: compare the wallets' sign-ins (admin page → sign-ins); a household or a café is fine, one person's wallets in one pool are not.
  - NOT JUDGED: open it and press JUDGE NOW first.`);
}

main().then((code) => prisma?.$disconnect().finally(() => process.exit(code)) ?? process.exit(code), (e) => die(e?.stack ?? e));
