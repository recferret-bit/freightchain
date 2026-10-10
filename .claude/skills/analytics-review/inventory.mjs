#!/usr/bin/env node
// Local drift check for the analytics review. No network, no env files, no PostHog.
// Exit 0 when the allowlists, the call sites, and the explainer name the same events.

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

function read(rel) {
  return readFileSync(join(root, rel), 'utf8');
}

function arrayNames(src, exportName) {
  const start = src.indexOf(`export const ${exportName} = [`);
  if (start < 0) throw new Error(`missing ${exportName}`);
  const end = src.indexOf('] as const', start);
  if (end < 0) throw new Error(`missing end of ${exportName}`);
  return [...src.slice(start, end).matchAll(/'([a-z][a-z0-9_]*)'/g)].map((m) => m[1]);
}

function allowMap(src) {
  const start = src.indexOf('const ALLOW');
  const end = src.indexOf('const MAX_KEYS', start);
  if (start < 0 || end < 0) throw new Error('missing ALLOW');
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

const clientSrc = read('server/src/domain/analytics/client-events.ts');
const serverSrc = read('server/src/domain/analytics/server-events.ts');
const factorySrc = read('server/src/application/services/analytics-events.ts');
const explainer = read('docs/analytics/index.html');

const clientEvents = arrayNames(clientSrc, 'CLIENT_EVENTS');
const serverEvents = arrayNames(serverSrc, 'SERVER_EVENTS');
const allow = allowMap(clientSrc);

const trees = ['client/js', 'client/site', 'landing/src'];
const files = trees.flatMap(jsFiles);
const calls = new Map();
const droppedKeys = [];

for (const path of files) {
  const text = readFileSync(path, 'utf8');
  const rel = path.slice(root.length + 1);
  for (const m of text.matchAll(/track\(\s*['"]([a-z][a-z0-9_]*)['"]\s*(?:,\s*(\{[^}]*\}))?/g)) {
    const name = m[1];
    const list = calls.get(name) ?? [];
    list.push(rel);
    calls.set(name, list);
    if (!m[2] || !allow.has(name)) continue;
    const allowed = new Set(allow.get(name));
    // Keys only: an identifier after `{` or `,`. A ternary colon (`status : null`) is not a key.
    for (const key of m[2].matchAll(/(?:^|[{,])\s*(?:(['"])([a-z_][a-z0-9_]*)\1|([a-z_][a-z0-9_]*))\s*(?::|,|\})/g)) {
      const prop = key[2] || key[3];
      if (prop === 'wallet' || allowed.has(prop)) continue;
      droppedKeys.push(`${rel}: ${name}.${prop}`);
    }
  }
}

const factories = [...factorySrc.matchAll(/serverEvent\(\s*'([a-z][a-z0-9_]*)'/g)].map((m) => m[1]);
const factorySet = new Set(factories);

const problems = [];
const note = (title, rows) => {
  if (rows.length === 0) return;
  problems.push(title);
  for (const row of rows) problems.push(`  ${row}`);
};

note('track() name is not a client event', [...calls.keys()].filter((n) => !clientEvents.includes(n)).sort());
note('client event has no track() call', clientEvents.filter((n) => !calls.has(n)));
note('serverEvent() name is not a server event', [...factorySet].filter((n) => !serverEvents.includes(n)).sort());
note('server event has no serverEvent() call', serverEvents.filter((n) => !factorySet.has(n)));
note('event name missing from docs/analytics/index.html', [...clientEvents, ...serverEvents].filter((n) => !explainer.includes(`<code>${n}</code>`)));
note('literal property the relay would drop', droppedKeys);

const browserEyebrow = explainer.match(/Browser events · (\d+)/);
const serverEyebrow = explainer.match(/Server events · (\d+)/);
if (!browserEyebrow || Number(browserEyebrow[1]) !== clientEvents.length) {
  problems.push(`explainer browser count is ${browserEyebrow?.[1] ?? 'missing'}, CLIENT_EVENTS has ${clientEvents.length}`);
}
if (!serverEyebrow || Number(serverEyebrow[1]) !== serverEvents.length) {
  problems.push(`explainer server count is ${serverEyebrow?.[1] ?? 'missing'}, SERVER_EVENTS has ${serverEvents.length}`);
}

const allowMissing = clientEvents.filter((n) => !allow.has(n));
if (allowMissing.length) problems.push(`ALLOW is missing ${allowMissing.join(', ')}`);

console.log(`client events ${clientEvents.length} · server events ${serverEvents.length} · js files ${files.length}`);
console.log('call sites');
for (const name of [...calls.keys()].sort()) console.log(`  ${name}  ${[...new Set(calls.get(name))].join(', ')}`);
if (problems.length === 0) {
  console.log('drift: none');
  process.exit(0);
}
console.log('drift:');
for (const line of problems) console.log(line);
process.exit(1);
