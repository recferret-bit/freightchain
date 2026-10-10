#!/usr/bin/env node
/** Compare the live EU project to spec.mjs. Writes a report. Does not edit PostHog.
 *  Exit 1 when a fix is waiting. Never prints the personal key. */

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { api, listInsights, redact, root } from './api.mjs';
import { buildQuery, eventsOf, specEvents } from './query.mjs';
import { DASHBOARD_ID, DATE_RANGE, insights } from './spec.mjs';

const sameList = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);

function normProps(list = []) {
  return list.map((p) => `${p.key}:${p.operator ?? 'exact'}:${JSON.stringify([].concat(p.value ?? []))}`).sort();
}

function liveSource(insight) {
  const q = insight.query;
  if (!q || q.kind !== 'InsightVizNode') return null;
  return q.source ?? null;
}

function windowOf(source) {
  const f = source?.funnelsFilter;
  if (!f) return null;
  if (f.funnelWindowInterval == null) return null;
  return `${f.funnelWindowInterval} ${f.funnelWindowIntervalUnit ?? 'day'}`;
}

function issuesFor(item, live) {
  const issues = [];
  const source = liveSource(live);
  if (!source) return ['no query'];
  if (source.kind !== item.kind) issues.push(`kind is ${source.kind}, expected ${item.kind}`);
  const want = specEvents(item);
  const got = item.kind === 'RetentionQuery'
    ? [source.retentionFilter?.targetEntity?.id ?? null, source.retentionFilter?.returningEntity?.id ?? null]
    : item.kind === 'PathsQuery'
      ? [source.pathsFilter?.startPoint ?? null]
      : eventsOf(source.series);
  if (got.some((e) => e == null)) issues.push(`a step is "All events" (event is empty). Expected ${want.join(' → ')}`);
  else if (!sameList(got, want)) issues.push(`steps are ${got.join(' → ')}. Expected ${want.join(' → ')}`);
  if (item.kind === 'FunnelsQuery') {
    const wantWindow = `${item.window.interval} ${item.window.unit}`;
    const gotWindow = windowOf(source);
    if (gotWindow !== wantWindow) issues.push(`conversion window is ${gotWindow ?? 'the PostHog default'}. Expected ${wantWindow}. The chart's date range is not the conversion window.`);
    (item.series ?? []).forEach((step, i) => {
      const node = source.series?.[i];
      if (!node || node.kind === 'GroupNode') return;
      const have = normProps(node.properties);
      const need = normProps(step.properties);
      for (const prop of need) if (!have.includes(prop)) issues.push(`step ${i + 1} ${step.event} is missing filter ${prop}`);
    });
    if (item.exclusions?.length && !(source.funnelsFilter?.exclusions?.length)) issues.push('the exclusion step is missing');
  }
  if (item.kind === 'TrendsQuery') {
    const display = source.trendsFilter?.display;
    if (item.display && display !== item.display) issues.push(`chart is ${display ?? 'unset'}. Expected ${item.display}`);
    if (item.formula && source.trendsFilter?.formula !== item.formula) issues.push(`formula is ${source.trendsFilter?.formula ?? 'unset'}. Expected ${item.formula}`);
    if (item.math && source.series?.[0]?.math && source.series[0].math !== item.math && source.series[0].kind !== 'GroupNode') {
      issues.push(`aggregation is ${source.series[0].math}. Expected ${item.math}`);
    }
    if (source.series?.[0]?.kind === 'GroupNode') issues.push('the series is an OR group. One web_vital series is the page-speed insight');
    const range = source.dateRange ?? {};
    if (range.date_from !== DATE_RANGE.date_from || range.date_to !== DATE_RANGE.date_to) {
      issues.push(`date range is ${range.date_from ?? 'default'} → ${range.date_to ?? 'now'}. Expected ${DATE_RANGE.date_from} → ${DATE_RANGE.date_to}`);
    }
  }
  const range = source.dateRange ?? {};
  if (item.kind !== 'TrendsQuery' && (range.date_from !== DATE_RANGE.date_from || range.date_to !== DATE_RANGE.date_to)) {
    issues.push(`date range is ${range.date_from ?? 'default'} → ${range.date_to ?? 'now'}. Expected ${DATE_RANGE.date_from} → ${DATE_RANGE.date_to}`);
  }
  const pinned = (live.dashboards ?? []).includes(DASHBOARD_ID);
  if (item.pin && !pinned) issues.push(`not on dashboard ${DASHBOARD_ID}`);
  if (!item.pin && pinned) issues.push(`pinned to dashboard ${DASHBOARD_ID}. This insight stays off the judge board`);
  return issues;
}

function matchScore(item, live) {
  const source = liveSource(live);
  if (!source || source.kind !== item.kind) return 0;
  if (live.name === item.name) return 100;
  const want = specEvents(item);
  const got = eventsOf(source.series);
  if (item.kind === 'FunnelsQuery' || item.kind === 'TrendsQuery' || item.kind === 'StickinessQuery' || item.kind === 'LifecycleQuery') {
    if (sameList(got, want)) return 80;
    if (want.length && got.length === want.length && got.slice(0, -1).every((e, i) => e === want[i]) && got.at(-1) == null) return 50;
  }
  if (item.kind === 'RetentionQuery') {
    const t = source.retentionFilter?.targetEntity?.id;
    const r = source.retentionFilter?.returningEntity?.id;
    if (t === item.target && r === item.returning) return 80;
    if (t === '$pageview' || r === '$pageview') return 0;
  }
  if (item.kind === 'PathsQuery' && source.pathsFilter?.startPoint === item.start) return 80;
  return 0;
}

function escape(s) {
  return String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
}

const templateNames = new Set([
  'Visit to interaction funnel', 'Top referrers', 'Retention', 'Weekly active users (WAUs)',
  'Daily active users (DAUs)', 'Pageviews (last 7 days)', 'Sessions (last 7 days)', 'Active users (last 30 days)',
]);

const dash = await api(`/api/projects/297915/dashboards/${DASHBOARD_ID}/`);
const live = await listInsights();
const used = new Set();
const rows = [];

for (const item of insights) {
  let best = null;
  let bestScore = 0;
  for (const insight of live) {
    if (used.has(insight.id)) continue;
    const score = matchScore(item, insight);
    if (score > bestScore) { best = insight; bestScore = score; }
  }
  if (best && bestScore >= 50) used.add(best.id);
  const problems = best && bestScore >= 50 ? issuesFor(item, best) : [`missing. ${item.caption}`];
  if (item.pin && !(dash.tiles ?? []).length && best && bestScore >= 50 && !problems.some((p) => p.startsWith('not on dashboard'))) {
    problems.push(`dashboard ${DASHBOARD_ID} has no tiles`);
  }
  rows.push({ item, live: bestScore >= 50 ? best : null, problems });
}

const extras = live.filter((insight) => !used.has(insight.id));
const fixes = [];
for (const row of rows) {
  if (!row.problems.length) continue;
  const where = row.live ? `insight ${row.live.id} “${row.live.name}”` : 'not created';
  fixes.push({ name: row.item.name, pin: row.item.pin, where, problems: row.problems });
}
const stray = [];
for (const insight of extras) {
  const source = liveSource(insight);
  const events = eventsOf(source?.series);
  const onJudge = (insight.dashboards ?? []).includes(DASHBOARD_ID);
  const pageview = events.includes('$pageview') || (source?.retentionFilter?.targetEntity?.id === '$pageview');
  if (pageview || templateNames.has(insight.name)) {
    stray.push({ name: insight.name, id: insight.id, note: onJudge
      ? `uses $pageview and is on dashboard ${DASHBOARD_ID}. That template does not see Freight Chain events.`
      : 'Template insight ($pageview). It is not the judge board. Leave it. Apply does not delete it.' });
    continue;
  }
  if (onJudge) stray.push({ name: insight.name, id: insight.id, note: `pinned to dashboard ${DASHBOARD_ID} and it is not in the spec` });
  else if (events.includes(null) || (insight.name ?? '').includes('7d') || (source?.dateRange?.date_from === '-7d' && events[0] === 'landing_viewed')) {
    stray.push({ name: insight.name, id: insight.id, note: 'A 7 day acquisition mixes yesterday’s landing into today’s click. Apply does not delete it. Leave it unpublished.' });
  }
}

const ok = rows.filter((row) => row.problems.length === 0);

const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>PostHog audit</title>
<style>
  body { margin: 0; background: #140e08; color: #f3e6cf; font: 15px/1.45 Georgia, serif; }
  main { max-width: 880px; margin: 0 auto; padding: 32px 20px 64px; }
  h1 { font-weight: 500; letter-spacing: .04em; }
  h2 { font-size: 1.15rem; margin-top: 2rem; color: #f0c14a; }
  .meta { color: #b7a48a; }
  article { border: 1px solid #5c4630; border-radius: 10px; padding: 12px 14px; margin: 10px 0; }
  .bad { border-color: #a85a3a; }
  .ok { border-color: #3f6b45; }
  code { font-family: ui-monospace, monospace; font-size: .86em; color: #f0c14a; }
  ul { margin: .4rem 0 0; }
  .invite { background: #2a2116; border: 1px solid #f0c14a; border-radius: 10px; padding: 14px 16px; }
</style></head><body><main>
<h1>PostHog audit</h1>
<p class="meta">Project 297915 · dashboard ${DASHBOARD_ID} “${escape(dash.name)}” · ${dash.tiles?.length ?? 0} tiles · ${live.length} saved insights · ${new Date().toISOString().slice(0, 16)} UTC</p>
<p>${fixes.length ? `${fixes.length} insight${fixes.length === 1 ? '' : 's'} still need a fix.` : 'The saved insights match the spec.'} Apply does not run unless you ask.</p>
<h2>Fixes</h2>
${fixes.length ? fixes.map((fix) => `<article class="bad"><b>${escape(fix.name)}</b> <span class="meta">${fix.pin ? '· pin on 1006663' : '· save, leave off 1006663'}</span><div class="meta">${escape(fix.where)}</div><ul>${fix.problems.map((p) => `<li>${escape(p)}</li>`).join('')}</ul></article>`).join('') : '<p>None.</p>'}
<h2>Leave alone</h2>
${stray.length ? stray.map((s) => `<article><b>${escape(s.name)}</b> <span class="meta">· ${s.id}</span><p>${escape(s.note)}</p></article>`).join('') : '<p>Nothing outside the spec.</p>'}
<h2>Already matching</h2>
${ok.length ? `<ul>${ok.map((row) => `<li><code>${escape(row.item.name)}</code> · insight ${row.live.id}</li>`).join('')}</ul>` : '<p>None yet.</p>'}
<div class="invite"><b>Apply these fixes?</b><p>Say <b>apply the PostHog fixes</b>. That runs <code>node .claude/skills/posthog-audit/apply.mjs --apply</code>, which creates the missing <code>FC ·</code> insights and updates a matched insight in place. It does not delete the template dashboard, and it does not send an event.</p></div>
</main></body></html>`;

const dir = join(root, 'docs/analytics/generated');
mkdirSync(dir, { recursive: true });
writeFileSync(join(dir, 'audit.html'), html);
writeFileSync(join(dir, 'audit.json'), JSON.stringify({
  dashboard: { id: DASHBOARD_ID, name: dash.name, tiles: dash.tiles?.length ?? 0 },
  fixes, stray, ok: ok.map((row) => row.item.name),
}, null, 2));
console.log(redact(`audit: ${fixes.length} fixes, ${ok.length} matching, ${stray.length} left alone`));
console.log(redact(`report: docs/analytics/generated/audit.html`));
process.exit(fixes.length ? 1 : 0);
