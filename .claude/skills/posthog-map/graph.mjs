#!/usr/bin/env node
/** Visual map of surfaces and events. Reads the allowlists, track() calls, and the audit spec.
 *  No network. Writes docs/insights/analytics/generated/map.html */

import { mkdirSync, readFileSync, readdirSync, statSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { insights } from '../posthog-audit/spec.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const outDir = join(root, 'docs/insights/analytics/generated');

function read(rel) { return readFileSync(join(root, rel), 'utf8'); }
function arrayNames(src, exportName) {
  const start = src.indexOf(`export const ${exportName} = [`);
  const end = src.indexOf('] as const', start);
  return [...src.slice(start, end).matchAll(/'([a-z][a-z0-9_]*)'/g)].map((m) => m[1]);
}
function allowMap(src) {
  const start = src.indexOf('const ALLOW');
  const end = src.indexOf('const MAX_KEYS', start);
  const out = new Map();
  for (const m of src.slice(start, end).matchAll(/([a-z][a-z0-9_]*):\s*\[([^\]]*)\]/g)) {
    out.set(m[1], [...m[2].matchAll(/'([a-z][a-z0-9_]*)'/g)].map((x) => x[1]));
  }
  return out;
}
function jsFiles(rel) {
  const out = [];
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      if (name === 'node_modules' || name === 'dist' || name.startsWith('.')) continue;
      const path = join(dir, name);
      if (statSync(path).isDirectory()) walk(path);
      else if (name.endsWith('.js')) out.push(path);
    }
  };
  walk(join(root, rel));
  return out;
}
function surfaceOf(rel) {
  if (rel.includes('whitepaper')) return 'Whitepaper';
  if (rel.startsWith('frontend/landing/') || rel.startsWith('landing/')) return 'Landing';
  if (rel.includes('/lobby') || rel.endsWith('pay.js')) return 'Lobby';
  if (rel.endsWith('wallet.js')) return 'Sign-in';
  if (rel.includes('web-vitals')) return 'Shared';
  if (rel.startsWith('frontend/client/') || rel.startsWith('client/')) return 'Game';
  return 'Other';
}
function escape(s) {
  return String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
}

const clientSrc = read('backend/server/src/domain/analytics/client-events.ts');
const clientNames = arrayNames(clientSrc, 'CLIENT_EVENTS');
const serverNames = arrayNames(read('backend/server/src/domain/analytics/server-events.ts'), 'SERVER_EVENTS');
const allow = allowMap(clientSrc);
const calls = new Map();
for (const path of ['frontend/client/js', 'frontend/client/site', 'frontend/landing/src'].flatMap(jsFiles)) {
  const rel = path.slice(root.length + 1);
  const text = readFileSync(path, 'utf8');
  for (const m of text.matchAll(/track\(\s*['"]([a-z][a-z0-9_]*)['"]/g)) {
    const list = calls.get(m[1]) ?? [];
    list.push(rel);
    calls.set(m[1], list);
  }
}
const serverFiles = new Map();
const factory = read('backend/server/src/application/services/analytics-events.ts');
for (const m of factory.matchAll(/serverEvent\(\s*'([a-z][a-z0-9_]*)'/g)) {
  serverFiles.set(m[1], 'backend/server/src/application/services/analytics-events.ts');
}

const surfaces = ['Landing', 'Whitepaper', 'Sign-in', 'Lobby', 'Game', 'Shared', 'Server'];
const columns = new Map(surfaces.map((name) => [name, []]));
for (const [name, files] of calls) {
  const surface = surfaceOf(files[0]);
  columns.get(surface)?.push({ name, plane: 'client', props: allow.get(name) ?? [], files });
}
for (const name of clientNames) {
  if (calls.has(name)) continue;
  columns.get('Shared').push({ name, plane: 'client', props: allow.get(name) ?? [], files: ['allowlist only, no track() call'] });
}
for (const name of serverNames) {
  columns.get('Server').push({ name, plane: 'server', props: [], files: serverFiles.has(name) ? [serverFiles.get(name)] : [] });
}
for (const list of columns.values()) list.sort((a, b) => a.name.localeCompare(b.name));

let checks = [];
const checksPath = join(outDir, 'checks.json');
if (existsSync(checksPath)) checks = JSON.parse(readFileSync(checksPath, 'utf8'));

const columnHtml = surfaces.map((name) => {
  const nodes = columns.get(name);
  return `<section><h2>${escape(name)} <span>${nodes.length}</span></h2>${nodes.map((node) => `<article class="${node.plane}" id="ev-${escape(node.name)}"><b>${escape(node.name)}</b><small>${node.plane}${node.props.length ? ' · ' + node.props.map(escape).join(', ') : ''}</small>${node.files.length ? `<small class="file">${node.files.map(escape).join('<br>')}</small>` : ''}</article>`).join('')}</section>`;
}).join('');

const funnelHtml = insights.filter((item) => item.kind === 'FunnelsQuery').map((item) => {
  const steps = item.series.map((step, i) => `<li><span>${i + 1}</span><a href="#ev-${escape(step.event)}">${escape(step.event)}</a></li>`).join('<i>→</i>');
  return `<article><header><b>${escape(item.name)}</b><em>${item.pin ? 'on the board' : 'saved, off the board'}</em><em>${item.window.interval} ${item.window.unit}</em></header><ol>${steps}</ol><p>${escape(item.caption)}</p></article>`;
}).join('');

const otherHtml = insights.filter((item) => item.kind !== 'FunnelsQuery').map((item) => {
  const what = item.kind === 'RetentionQuery' ? `${item.target} → ${item.returning}`
    : item.kind === 'PathsQuery' ? `start ${item.start}`
    : (item.series ?? []).map((step) => step.event).join(' · ');
  return `<article><header><b>${escape(item.name)}</b><em>${escape(item.kind.replace('Query', ''))}</em><em>${item.pin ? 'on the board' : 'off the board'}</em></header><p><code>${escape(what)}</code></p><p>${escape(item.caption)}</p></article>`;
}).join('');

const checkHtml = checks.length ? `<p class="checks">${checks.map((c) => `<span class="${c.ok ? 'pass' : 'fail'}">${escape(c.name)} ${c.ok ? 'passed' : 'failed'}</span>`).join('')}</p>` : '';

const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Freight Chain events</title>
<style>
  :root { color-scheme: dark; }
  body { margin: 0; background: #120e0a; color: #f4ead8; font: 14px/1.4 "Avenir Next", Georgia, sans-serif; }
  header.top { padding: 28px 22px 8px; }
  h1 { font-weight: 560; letter-spacing: .06em; margin: 0; }
  .lede { color: #cbbba4; max-width: 70ch; }
  .checks span { display: inline-block; margin: 4px 8px 0 0; padding: 2px 8px; border-radius: 99px; border: 1px solid #5c4630; }
  .pass { color: #b7e0b0; } .fail { color: #f0a090; }
  .board { display: grid; grid-template-columns: repeat(7, minmax(140px, 1fr)); gap: 10px; padding: 12px 18px 28px; overflow-x: auto; }
  section h2 { font-size: 13px; letter-spacing: .12em; text-transform: uppercase; color: #f0c14a; margin: 0 0 8px; }
  section h2 span { color: #8d7b66; }
  article { border: 1px solid #4a3b2c; border-radius: 8px; padding: 7px 8px; margin: 0 0 6px; background: #1b140f; }
  article.server { border-color: #6a5430; }
  article b { display: block; font-family: ui-monospace, monospace; font-size: 12px; }
  small { display: block; color: #b7a48a; font-size: 11px; }
  small.file { color: #7f6e5c; }
  h2.band { padding: 0 22px; color: #f0c14a; font-weight: 540; }
  .funnels, .others { padding: 0 18px 20px; display: grid; gap: 8px; }
  .funnels article, .others article { padding: 10px 12px; }
  ol { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; list-style: none; padding: 0; margin: 8px 0; }
  ol li { display: flex; gap: 6px; align-items: center; background: #2a2118; border-radius: 99px; padding: 3px 8px; }
  ol li span { color: #f0c14a; }
  ol a { color: #f4ead8; text-decoration: none; font-family: ui-monospace, monospace; font-size: 12px; }
  ol i { color: #8d7b66; font-style: normal; }
  header em { font-style: normal; color: #b7a48a; margin-left: 8px; font-size: 12px; }
  code { font-family: ui-monospace, monospace; color: #f0c14a; }
</style></head><body>
<header class="top"><h1>Freight Chain · events</h1>
<p class="lede">One node per event the code can send. Client events are what the browser posts to <code>/api/telemetry</code>. Server events are written after the database commit. The chains below are the insights in the audit spec, not whatever is currently saved in PostHog.</p>
${checkHtml}</header>
<div class="board">${columnHtml}</div>
<h2 class="band">Funnels</h2><div class="funnels">${funnelHtml}</div>
<h2 class="band">Trends, retention, paths, stickiness, lifecycle</h2><div class="others">${otherHtml}</div>
</body></html>`;

mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, 'map.html'), html);
const total = [...columns.values()].reduce((n, list) => n + list.length, 0);
console.log(`map: ${total} events across ${surfaces.length} surfaces → docs/insights/analytics/generated/map.html`);
