#!/usr/bin/env node
/** Write the spec to PostHog. Default is a dry run. --apply creates and updates.
 *  Does not delete insights. Does not send events. Never prints the personal key. */

import { api, listInsights, redact } from './api.mjs';
import { buildQuery, specEvents } from './query.mjs';
import { DASHBOARD_ID, insights } from './spec.mjs';

const apply = process.argv.includes('--apply');

function score(item, live) {
  const source = live.query?.source;
  if (!source || source.kind !== item.kind) return 0;
  if (live.name === item.name) return 100;
  const got = (source.series ?? []).flatMap((node) => node.kind === 'GroupNode' ? (node.nodes ?? []).map((child) => child.event ?? null) : [node.event ?? null]);
  const want = specEvents(item);
  if (item.kind === 'PathsQuery') return source.pathsFilter?.startPoint === item.start ? 80 : 0;
  if (item.kind === 'RetentionQuery') {
    return source.retentionFilter?.targetEntity?.id === item.target && source.retentionFilter?.returningEntity?.id === item.returning ? 80 : 0;
  }
  if (got.length === want.length && got.every((event, i) => event === want[i])) return 80;
  if (want.length && got.length === want.length && got.slice(0, -1).every((event, i) => event === want[i]) && got.at(-1) == null) return 50;
  return 0;
}

const live = await listInsights();
const used = new Set();
let writes = 0;
for (const item of insights) {
  let best = null;
  let bestScore = 0;
  for (const insight of live) {
    if (used.has(insight.id)) continue;
    const s = score(item, insight);
    if (s > bestScore) { best = insight; bestScore = s; }
  }
  const query = buildQuery(item);
  const dashboards = item.pin ? [DASHBOARD_ID] : (best?.dashboards ?? []).filter((id) => id !== DASHBOARD_ID);
  const body = { name: item.name, description: item.caption, saved: true, query, dashboards };
  if (best && bestScore >= 50) {
    used.add(best.id);
    console.log(redact(`${apply ? 'update' : 'would update'} ${best.id} “${best.name}” → “${item.name}” pin=${item.pin}`));
    if (apply) await api(`/api/projects/297915/insights/${best.id}/`, { method: 'PATCH', body });
  } else {
    console.log(redact(`${apply ? 'create' : 'would create'} “${item.name}” pin=${item.pin}`));
    if (apply) await api('/api/projects/297915/insights/', { method: 'POST', body });
  }
  writes += 1;
}
console.log(redact(apply ? `applied ${writes} insights` : `dry run, ${writes} insights. Pass --apply to write them.`));
