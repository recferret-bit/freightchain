#!/usr/bin/env node
/* RIDE AUDIT – is this stream honest? (the `ride-audit` skill: .claude/skills/ride-audit)
   Loads a ride and its whole recording straight from a database – the local one, any DATABASE_URL, or PRODUCTION through the read-only ops tunnel – and
   audits it from scratch with the server's own code (src/domain/verdict/ride-audit.ts): rebuilds the ride's road and its holes from the seed, re-hashes
   every batch, measures every sample again (the inputs, every hole pass, off-road, speed gained without gas), judges the ride at the CURRENT rules and
   compares that with the verdict on record. Read-only everywhere: one SELECT per ride (production: inside a read-only transaction, ops.sh).

     node scripts/ride-audit.mjs <ride id> [--json] [--all-passes]          one ride, the full report
     node scripts/ride-audit.mjs --latest N [--wallet W] [--status S]       the N latest started rides, one line each (+ the report of every NOT OK one)
     sources: --prod (production via `npm run ops -- sql`) · --db URL · default DATABASE_URL, else server/.env (ENV_FILE=… for another file)

   A ride that did not complete (failed, abandoned, running) is never judged by the live verdict: it is reported (n/a) but does not fail the exit code.
   Needs a build of the server: AUDIT_BUILD=<dir> (default dist; .claude/skills/ride-audit/run.sh builds a private copy). Exit: 0 every audited ride OK,
   1 at least one NOT OK, 2 usage / loading error. */
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url)), SERVER = resolve(HERE, '..'), ROOT = resolve(SERVER, '../..');
const BUILD = resolve(SERVER, process.env.AUDIT_BUILD ?? 'dist');
const args = process.argv.slice(2), flag = (f) => args.includes(f), opt = (f) => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : undefined; };
const die = (msg) => { console.error(`ride-audit: ${msg}`); process.exit(2); };
if (!existsSync(join(BUILD, 'domain/verdict/ride-audit.js'))) die(`no server build at ${BUILD} – run .claude/skills/ride-audit/run.sh (it builds one), or npm run server:build`);

const { auditRide } = await import(join(BUILD, 'domain/verdict/ride-audit.js'));
const { RideMapper } = await import(join(BUILD, 'infrastructure/prisma/mappers/ride.mapper.js'));
const { RideBatch } = await import(join(BUILD, 'domain/telemetry/ride-batch.entity.js'));
const { gunzipSync } = await import('node:zlib');

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i, WALLET = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/, STATUSES = ['running', 'completed', 'abandoned', 'failed'];

/* ───────── where the rows come from ───────── */
function databaseUrl() {
  if (opt('--db')) return opt('--db');
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  const file = resolve(SERVER, process.env.ENV_FILE ?? '.env');
  if (!existsSync(file)) die('no database: give --db URL, set DATABASE_URL, or create backend/server/.env');
  const line = readFileSync(file, 'utf8').split('\n').find((l) => l.startsWith('DATABASE_URL='));   // the value is used, never printed
  if (!line) die(`${file} has no DATABASE_URL`);
  return line.slice('DATABASE_URL='.length).replace(/^["']|["']$/g, '');
}
let prisma = null;
async function sql(text) {
  if (flag('--prod')) {
    const r = spawnSync('bash', [join(ROOT, 'infra/deploy/scripts/ops.sh'), 'sql'], { input: `\\pset format unaligned\n\\pset tuples_only on\n${text}\n`, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
    if (r.status !== 0) die(`production query failed: ${(r.stderr || r.stdout).trim().split('\n').slice(-3).join(' · ')}`);
    return r.stdout.split('\n').map((l) => l.trim()).filter(Boolean);
  }
  if (!prisma) { const { PrismaClient } = await import('@prisma/client'); prisma = new PrismaClient({ datasources: { db: { url: databaseUrl() } } }); }
  return (await prisma.$transaction(async (tx) => { await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY'); return tx.$queryRawUnsafe(text); })).map((row) => String(Object.values(row)[0]));
}

const rideSql = (id) => `SELECT json_build_object(
  'ride', (SELECT to_jsonb(r) FROM ride."Ride" r WHERE r.id = '${id}'),
  'batches', (SELECT coalesce(json_agg(json_build_object('rideId', b."rideId", 'seq', b.seq, 'prevHash', b."prevHash", 'hash', b.hash, 'hashOk', b."hashOk", 't0', b.t0, 't1', b.t1,
    'samples', b.samples, 'inputs', b.inputs, 'bytes', b.bytes, 'payload', encode(b.payload, 'base64'), 'receivedAt', b."receivedAt") ORDER BY b.seq), '[]'::json)
    FROM telemetry."RideBatch" b WHERE b."rideId" = '${id}'),
  'verdict', (SELECT to_jsonb(v) FROM verdict."RideVerdict" v WHERE v."rideId" = '${id}'))::text`;

const DATES = ['createdAt', 'quoteExpiresAt', 'paidAt', 'startedAt', 'lastHbAt', 'endedAt', 'receivedAt', 'judgedAt', 'overriddenAt'];
const dated = (o) => { for (const k of DATES) if (typeof o[k] === 'string') o[k] = new Date(/[zZ]|[+-]\d\d:?\d\d$/.test(o[k]) ? o[k] : `${o[k]}Z`); return o; };   // timestamp(3) columns carry no zone: they are UTC

async function loadRide(id) {
  const [text] = await sql(rideSql(id));
  const data = text ? JSON.parse(text) : null;
  if (!data?.ride) return null;
  const ride = RideMapper.toDomain(dated({ ...data.ride, lamports: BigInt(Math.round(Number(data.ride.lamports ?? 0))) }));
  const batches = data.batches.map((b) => {
    const body = JSON.parse(gunzipSync(Buffer.from(b.payload, 'base64')).toString('utf8'));
    const hashOk = body.hash !== null && createHash('sha256').update(RideBatch.canonical(body), 'utf8').digest('hex') === body.hash;   // re-hashed here: the stored hashOk column is not taken on trust
    return RideBatch.restore({ ...dated(b), body, hashOk, summary: null });
  });
  const v = data.verdict;
  return { ride, batches, stored: v ? { status: v.status, reasons: v.reasons ?? [], rulesVersion: v.rulesVersion, overriddenBy: v.overriddenBy ?? null } : null };
}

/* ───────── printing ───────── */
const km = (m) => `${(m / 1000).toFixed(2)} km`, pad = (s, n) => String(s).padEnd(n), lpad = (s, n) => String(s).padStart(n);
const MARK = { hit: '✓ HIT    ', avoided: '✓ AVOIDED', ignored: '✗ IGNORED', other: '· graze  ' };
function print(rep) {
  const r = rep.ride, rec = rep.recording, out = [];
  out.push(`RIDE ${r.id}  ${r.wallet}  ${r.tier} · ${r.status} · seed ${r.seed} · route ${r.route ?? '?'}`);
  out.push(`     ${km(r.distance)} in ${r.driveSeconds} s driven · hull at the end ${r.hull === null ? '?' : Math.round(r.hull * 10) / 10} % · ${r.startedAt ?? '?'} → ${r.endedAt ?? 'still running'}`);
  out.push(`RECORDING  ${rec.batches} batches · ${rec.samples} samples · ${rec.inputs} input events (${rec.presses} presses, ${rec.gasPresses} on the gas) · ${rec.recordedSeconds} s · s ${rec.fromS} → ${rec.toS} m`);
  out.push(`           ${rec.hashesReproduced}/${rec.batches} batch hashes reproduced here${rec.replayColumns ? '' : ' · no input column (recorded before it) – the gas check cannot run'}`);
  out.push(`ROAD       the server's plan from seed ${r.seed}: ${rep.road.planned} hole${rep.road.planned === 1 ? '' : 's'} on the driven stretch, ${rep.road.reached} reached by the truck`);
  for (const h of rep.road.holes) {
    out.push(`  ${lpad(km(h.s), 9)}  ${pad(h.type, 8)} lane ${lpad(h.lat.toFixed(1), 5)}  t ${lpad(h.t.toFixed(1), 7)} s  ${MARK[h.outcome]}  hull −${h.got.toFixed(1)} % (the game takes ${h.expected.toFixed(1)} %)`);
    if (flag('--all-passes') || h.outcome === 'ignored') for (const p of h.passes) out.push(`             axle ${['front', 'drive', 'trailer'][p.axle]} · wheel ${p.miss < 0 ? `${(-p.miss).toFixed(2)} m inside the pit` : `${p.miss.toFixed(2)} m clear`} · v ${p.v0} → ${p.v1} m/s · hull ${p.hull0} → ${p.hull1} · ${p.kind}${p.edge ? ' (across a batch boundary)' : ''}`);
  }
  out.push(`OFF-ROAD   longest spell ${rep.offroadPeakSeconds} s (the game ends a ride at 20 s)`);
  out.push(`GAS        ${rep.gasless.length ? `${rep.gasless.length} speed rise${rep.gasless.length > 1 ? 's' : ''} with the pedal up: ${rep.gasless.slice(0, 5).map(([t, dv]) => `t ${t} s +${dv} m/s`).join(', ')}` : 'no speed gained with the pedal up'}`);
  out.push(`VERDICT    judged now (rules v${rep.verdict.rulesVersion}): ${rep.verdict.status.toUpperCase()}`);
  for (const x of rep.verdict.reasons) out.push(`  ${x.severity === 'reject' ? '✗' : '!'} ${x.code} – ${x.detail}`);
  if (rep.stored) out.push(`ON RECORD  ${rep.stored.status} (rules v${rep.stored.rulesVersion}${rep.stored.overriddenBy ? `, set by hand by ${rep.stored.overriddenBy}` : ''}) ${rep.stored.reasons.map((x) => x.code).join(', ') || '–'}${rep.agrees ? ' · same as now' : ' · DIFFERS from the fresh judgement'}`);
  else out.push('ON RECORD  no verdict (only completed shifts are judged)');
  if (r.status !== 'completed') out.push(`RESULT     not judged – the ride is ${r.status} (the verdict judges completed shifts only); the stream as it stands: ${rep.verdict.status}${rep.verdict.reasons.length ? ` (${rep.verdict.reasons.map((x) => x.code).join(', ')})` : ''}`);
  else out.push(rep.ok ? 'RESULT     OK – the stream is consistent with the server\'s road and passes every check' : `RESULT     NOT OK – ${rep.verdict.status}: ${rep.verdict.reasons.map((x) => x.code).join(', ')}`);
  console.log(out.join('\n'));
}
const judged = (rep) => rep.ride.status === 'completed';
const oneLine = (rep) => `${!judged(rep) ? 'n/a   ' : rep.ok ? 'OK    ' : 'NOT OK'}  ${rep.ride.id}  ${rep.ride.wallet.slice(0, 6)}…  ${pad(rep.ride.status, 9)} ${lpad(km(rep.ride.distance), 9)}  holes ${rep.road.holes.filter((h) => h.outcome === 'hit').length} hit / ${rep.road.holes.filter((h) => h.outcome === 'avoided').length} avoided / ${rep.road.holes.filter((h) => h.outcome === 'ignored').length} ignored  ${rep.verdict.status}${rep.verdict.reasons.length ? ` (${rep.verdict.reasons.map((x) => x.code).join(', ')})` : ''}`;

/* ───────── main ───────── */
async function main() {
  const latest = opt('--latest'), id = args.find((a) => UUID.test(a));
  let ids;
  if (latest) {
    const n = Number(latest), wallet = opt('--wallet'), status = opt('--status');
    if (!Number.isInteger(n) || n < 1 || n > 200) die('--latest takes 1..200');
    if (wallet && !WALLET.test(wallet)) die('--wallet: not a wallet address');
    if (status && !STATUSES.includes(status)) die(`--status: one of ${STATUSES.join(' | ')}`);
    ids = (await sql(`SELECT id FROM ride."Ride" WHERE "startedAt" IS NOT NULL${wallet ? ` AND wallet = '${wallet}'` : ''}${status ? ` AND status = '${status}'` : ''} ORDER BY "startedAt" DESC LIMIT ${n}`)).filter((x) => UUID.test(x));
    if (!ids.length) { console.log('no started rides match'); return 0; }
  } else if (id) ids = [id];
  else die('give a ride id, or --latest N (see the header of this script)');
  const reports = [];
  for (const rideId of ids) {
    const loaded = await loadRide(rideId);
    if (!loaded) { if (!latest) die(`no ride ${rideId} in that database`); continue; }
    reports.push(auditRide(loaded.ride, loaded.batches, new Date(), loaded.stored));
  }
  if (flag('--json')) console.log(JSON.stringify(latest ? reports : reports[0], null, 2));
  else if (latest) { for (const rep of reports) console.log(oneLine(rep)); for (const rep of reports.filter((x) => judged(x) && !x.ok)) { console.log(''); print(rep); } }
  else print(reports[0]);
  return reports.filter(judged).every((x) => x.ok) ? 0 : 1;   // a ride that did not complete is never judged: it does not fail the audit
}
main().then((code) => prisma?.$disconnect().finally(() => process.exit(code)) ?? process.exit(code), (e) => die(e?.stack ?? e));
