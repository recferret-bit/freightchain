#!/usr/bin/env node
/** Refresh the README Traction block from posthog-audit and the public stats API.
 *  Does not deploy. Does not apply PostHog fixes. Does not print a key. */

import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { api, redact, root } from '../posthog-audit/api.mjs';
import { acceptStats, placeTraction, renderTraction, selfTest, spliceTraction } from './render.mjs';

const readmePath = join(root, 'README.md');
const outPath = join(root, 'docs/traction/latest.json');
const JUDGE_FROM = '2026-10-08 00:00:00';
const JUDGE_TO = '2026-10-13 00:00:00';

if (process.argv.includes('--self-test')) {
  selfTest();
  process.exit(0);
}

function runNode(script) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [script], { cwd: root });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('close', (status) => resolve({ status, stdout, stderr }));
  });
}

async function stats() {
  const reads = [];
  for (let i = 0; i < 3; i++) {
    try {
      const res = await fetch('https://freightchain.fun/api/stats', { headers: { Accept: 'application/json' } });
      if (!res.ok) continue;
      const body = acceptStats(await res.json());
      if (body) reads.push(body);
    } catch { /* retry */ }
    await new Promise((resolve) => setTimeout(resolve, 400));
  }
  const same = (a, b) => a.rides === b.rides && a.metres === b.metres && a.ridesCompleted === b.ridesCompleted && a.updatedAt === b.updatedAt;
  for (let i = 0; i < reads.length; i++) {
    if (reads.slice(i + 1).some((other) => same(reads[i], other))) return reads[i];
  }
  return reads.length === 1 ? reads[0] : null;
}

const METRICS = `countIf(event = 'landing_viewed' AND coalesce(toString(properties.surface), '') != 'prod-check') AS landing_events,
  uniqIf(distinct_id, event = 'landing_viewed' AND coalesce(toString(properties.surface), '') != 'prod-check') AS landing_people,
  uniqIf(distinct_id, event = 'whitepaper_viewed' AND coalesce(toString(properties.surface), '') != 'prod-check') AS whitepaper_people,
  countIf(event = 'ride_started' AND toString(properties.source) = 'server' AND toString(properties.is_demo) = 'false') AS starts_real,
  countIf(event = 'ride_completed' AND toString(properties.source) = 'server' AND toString(properties.is_demo) = 'false') AS completes_real,
  countIf(event = 'ride_started' AND toString(properties.source) = 'server' AND toString(properties.is_demo) = 'true') AS starts_demo,
  countIf(event = 'ride_completed' AND toString(properties.source) = 'server' AND toString(properties.is_demo) = 'true') AS completes_demo,
  countIf(event = 'player_signed_in' AND toString(properties.source) = 'server' AND toString(properties.is_demo) = 'false') AS signins_real`;

function hogql(from, to) {
  return `SELECT ${METRICS}
FROM events
WHERE timestamp >= toDateTime('${from}') AND timestamp < toDateTime('${to}')
  AND event IN ('landing_viewed', 'whitepaper_viewed', 'ride_started', 'ride_completed', 'player_signed_in')`;
}

function rowOf(body) {
  const columns = body?.columns;
  const first = body?.results?.[0];
  if (!Array.isArray(columns) || !Array.isArray(first)) return null;
  const row = {};
  columns.forEach((name, i) => { row[name] = first[i]; });
  const keys = ['landing_events', 'landing_people', 'whitepaper_people', 'starts_real', 'completes_real', 'starts_demo', 'completes_demo', 'signins_real'];
  for (const key of keys) if (!Number.isSafeInteger(row[key]) || row[key] < 0) return null;
  if (row.landing_people > row.landing_events) return null;
  return row;
}

async function oneWindow(from, to) {
  const reads = [];
  for (let i = 0; i < 3; i++) {
    try {
      const body = await api('/api/projects/297915/query/', { method: 'POST', body: { query: { kind: 'HogQLQuery', query: hogql(from, to) } } });
      const row = rowOf(body);
      if (row) reads.push(row);
    } catch (error) {
      if (i === 2 && !reads.length) return { error: redact(error.message).slice(0, 240) };
    }
  }
  if (reads.length < 2) return { error: 'fewer than two matching reads' };
  const key = (row) => JSON.stringify(row);
  const agreed = reads.find((row) => reads.filter((other) => key(other) === key(row)).length >= 2);
  if (!agreed) return { error: 'the three reads disagreed' };
  return {
    landingPeople: agreed.landing_people,
    landingEvents: agreed.landing_events,
    whitepaperPeople: agreed.whitepaper_people,
    startsReal: agreed.starts_real,
    completesReal: agreed.completes_real,
    startsDemo: agreed.starts_demo,
    completesDemo: agreed.completes_demo,
    signinsReal: agreed.signins_real,
  };
}

async function audit() {
  const result = await runNode(join(root, '.claude/skills/posthog-audit/audit.mjs'));
  let parsed = null;
  try { parsed = JSON.parse(readFileSync(join(root, 'docs/analytics/generated/audit.json'), 'utf8')); } catch { /* missing */ }
  return {
    exitCode: result.status,
    fixes: parsed?.fixes?.length ?? null,
    fixNames: (parsed?.fixes ?? []).map((fix) => fix.name),
    matching: parsed?.ok?.length ?? null,
    leftAlone: parsed?.stray?.length ?? null,
    error: parsed ? null : redact(`${result.stderr ?? ''}\n${result.stdout ?? ''}`).slice(0, 240),
  };
}

const today = new Date();
const through = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() + 1));
const throughStamp = `${through.toISOString().slice(0, 10)} 00:00:00`;

const [statsBody, judge, toDate, auditReport] = await Promise.all([
  stats(),
  oneWindow(JUDGE_FROM, JUDGE_TO).catch((error) => ({ error: redact(error.message).slice(0, 240) })),
  oneWindow(JUDGE_FROM, throughStamp).catch((error) => ({ error: redact(error.message).slice(0, 240) })),
  audit(),
]);

const windows = [];
if (!judge.error) windows.push({ label: '8–12 Oct 2026 (judge board)', ...judge });
if (!toDate.error) windows.push({ label: `8 Oct 2026 through ${today.toISOString().slice(0, 10)} UTC`, ...toDate });
let disagreement = null;
if (statsBody && toDate && !toDate.error) {
  const finishes = (toDate.completesReal ?? 0) + (toDate.completesDemo ?? 0);
  if (finishes !== statsBody.ridesCompleted) {
    disagreement = `PostHog counts ${finishes} server ride_completed events in the open window. The public stats endpoint says ${statsBody.ridesCompleted} finished shifts. The shifts line above is the public endpoint.`;
  }
}
const insights = {
  audit: auditReport.error ? null : auditReport,
  windows,
  error: windows.length ? null : (judge.error || toDate.error || auditReport.error || 'no insight counts'),
  disagreement,
};

const fetchedAt = new Date().toISOString();
const block = renderTraction({ fetchedAt, stats: statsBody, insights });
const readme = readFileSync(readmePath, 'utf8');
writeFileSync(readmePath, placeTraction(spliceTraction(readme, block)));
mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, JSON.stringify({ fetchedAt, stats: statsBody, insights }, null, 2));
console.log(`traction ${fetchedAt} rides=${statsBody?.rides ?? 'none'} audit=${auditReport.fixes ?? 'unread'}`);
