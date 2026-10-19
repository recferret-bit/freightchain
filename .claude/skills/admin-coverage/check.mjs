#!/usr/bin/env node
/* Admin API ⇄ admin page audit (static, no server, no network).
   1. every route of an `api/admin` controller  → is it behind AdminGuard (class or method) or an explicit @AdminPublic()?
   2. every route                               → does the admin page (client/site/admin*.js) call it?  (a *.challenge route is called through signAt())
   3. every call the page makes                 → does a route answer it?
   4. admin.html tabs ⇄ TABS in admin.js        → no link without a view, no view without a link
   5. info: routes the real-Chrome suite (server/scripts/e2e-admin.mjs) never names.
   Exit 1 on 1–4. `--json` prints the report as JSON. */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(fileURLToPath(import.meta.url), '../../../..');
const read = p => readFileSync(join(ROOT, p), 'utf8');
const walk = d => readdirSync(join(ROOT, d)).flatMap(f => { const p = `${d}/${f}`; return statSync(join(ROOT, p)).isDirectory() ? walk(p) : [p]; });

/* ── routes ── decorators are read as runs: consecutive `@X(...)` groups (balanced parentheses, any quotes) in front of a class or a method ── */
const VERBS = ['Get', 'Post', 'Put', 'Patch', 'Delete'];
function decoratorRuns(src) {   // → [{ names: [{ name, args }], end }] in source order
  const runs = [];
  for (let i = 0; i < src.length;) {
    const m = /^\s*@(\w+)\(/.exec(src.slice(i));
    if (!m) { i++; continue; }
    const run = { names: [], start: i };
    let j = i;
    for (let d; (d = /^\s*@(\w+)\(/.exec(src.slice(j))); ) {
      let k = j + d[0].length, depth = 1;
      for (; k < src.length && depth; k++) {
        const c = src[k];
        if (c === "'" || c === '"' || c === '`') { const l = literalAfter(src, k); if (!l) break; k = l.end - 1; } else if (c === '(') depth++; else if (c === ')') depth--;
      }
      run.names.push({ name: d[1], args: src.slice(j + d[0].length, k - 1) });
      j = k;
    }
    run.end = j; runs.push(run); i = j;
  }
  return runs;
}
const firstLiteral = args => { const t = args.trim(); return t[0] === '{' ? t.match(/path\s*:\s*(['"`])([^'"`]*)\1/)?.[2] : literalAfter(t, 0)?.text; };
const routes = [];
for (const file of walk('backend/server/src/presentation').filter(f => f.endsWith('.controller.ts'))) {
  const src = read(file);
  const runs = decoratorRuns(src);
  let base = null, classGuarded = false;
  for (const run of runs) {
    const has = n => run.names.some(d => d.name === n);
    const ctl = run.names.find(d => d.name === 'Controller');
    if (ctl) { base = firstLiteral(ctl.args) ?? ''; classGuarded = has('UseGuards') && run.names.filter(d => d.name === 'UseGuards').some(d => /\bAdminGuard\b/.test(d.args)); continue; }
    const verb = run.names.find(d => VERBS.includes(d.name));
    if (!verb || base == null || !base.startsWith('api/admin')) continue;
    const path = [base, firstLiteral(verb.args) ?? ''].filter(Boolean).join('/');
    routes.push({ key: `${verb.name.toUpperCase()} ${path}`, file, guarded: classGuarded || run.names.some(d => d.name === 'UseGuards' && /\bAdminGuard\b/.test(d.args)), public: has('AdminPublic') });
  }
}

/* ── calls made by the page: api('x'), api('x', body), signAt('x', intent) – first argument, string or template literal ── */
function literalAfter(src, i) {   // the literal that starts at src[i], with nested `${…}` (even with backticks inside) → { text, end }
  const q = src[i];
  if (q !== "'" && q !== '`' && q !== '"') return null;
  let out = '';
  for (let j = i + 1; j < src.length; j++) {
    const c = src[j];
    if (c === '\\') { out += src[++j]; continue; }
    if (c === q) return { text: out, end: j + 1 };
    if (q === '`' && c === '$' && src[j + 1] === '{') {
      let depth = 1, k = j + 2;
      for (; k < src.length && depth; k++) { if (src[k] === '{') depth++; else if (src[k] === '}') depth--; else if (src[k] === '`' || src[k] === "'" || src[k] === '"') { const n = literalAfter(src, k); if (!n) return null; k = n.end - 1; } }
      out += '\u0000'; j = k - 1; continue;
    }
    out += c;
  }
  return null;
}
const normalise = t => t.split('?')[0].replace(/(^|\/)\u0000(?=\/|$)/g, '$1:p').replace(/\u0000/g, '').replace(/\/$/, '');   // a whole-segment placeholder = a path parameter; one glued to text (`promos${state ? …}`) is a query string
const calls = [];
for (const file of walk('frontend/client/site').filter(f => /\/admin[^/]*\.js$/.test(f))) {
  const src = read(file).replace(/\/\*[\s\S]*?\*\//g, c => c.replace(/[^\n]/g, ' ')).replace(/^(\s*)\/\/.*$/gm, '$1');   // comments out, offsets kept
  for (const m of src.matchAll(/\b(api|signAt)\(\s*/g)) {
    const lit = literalAfter(src, m.index + m[0].length);
    if (!lit) continue;
    const after = src.slice(lit.end);
    const concat = /^\s*\+/.test(after);   // 'rides/' + id → a path parameter
    const rest = after.match(/^\s*([,)])/)?.[1];   // `api(path, body)` → POST (api() posts when body is truthy), `api(path)` → GET; signAt is always a POST
    const noBody = rest === ',' && /^\s*,\s*(null|undefined|false)\b/.test(after);
    const verb = m[1] === 'signAt' || (rest === ',' && !noBody) ? 'POST' : 'GET';
    calls.push({ key: `${verb} api/admin/${normalise(lit.text + (concat ? '\u0000' : ''))}`, file, line: src.slice(0, m.index).split('\n').length });
  }
}
const sameRoute = (a, b) => { const [av, ap] = a.split(' '), [bv, bp] = b.split(' '); const x = ap.split('/'), y = bp.split('/'); return av === bv && x.length === y.length && x.every((s, i) => s === y[i] || s.startsWith(':') || y[i].startsWith(':')); };

const problems = [];
for (const r of routes) if (!r.guarded && !r.public) problems.push(`unguarded: ${r.key} (${r.file}) – no AdminGuard on the class or the method and no @AdminPublic()`);
for (const r of routes) if (!calls.some(c => sameRoute(c.key, r.key))) problems.push(`not in the admin page: ${r.key} (${r.file}) – add a view / control to frontend/client/site/admin*.js`);
for (const c of calls) if (!routes.some(r => sameRoute(c.key, r.key))) problems.push(`dead call: ${c.key} (${c.file}:${c.line}) – no admin route answers it`);

/* ── tabs ── */
const html = read('frontend/client/admin.html').match(/data-tab="([\w-]+)"/g)?.map(s => s.slice(10, -1)) ?? [];
const TABS = (read('frontend/client/site/admin.js').match(/const TABS = \[([^\]]*)\]/)?.[1].match(/'([\w-]+)'/g) ?? []).map(s => s.slice(1, -1));
for (const t of html) if (!TABS.includes(t)) problems.push(`tab link without a view: data-tab="${t}" in admin.html is not in TABS (admin.js)`);
for (const t of TABS) if (!html.includes(t)) problems.push(`view without a tab link: "${t}" is in TABS (admin.js) but admin.html has no data-tab="${t}"`);

/* ── info: the browser suite ── */
const e2e = read('backend/server/scripts/e2e-admin.mjs');
const untested = routes.filter(r => { const tail = r.key.split(' ')[1].replace(/^api\/admin\/?/, '').split('/').filter(s => !s.startsWith(':')); return !tail.length || !tail.every(s => e2e.includes(s)); }).map(r => r.key);

const report = { routes: routes.length, calls: calls.length, tabs: TABS, problems, notInE2e: untested };
if (process.argv.includes('--json')) console.log(JSON.stringify(report, null, 2));
else {
  console.log(`${routes.length} admin routes · ${calls.length} calls from the page · tabs: ${TABS.join(', ')}`);
  for (const r of routes) console.log(`  ${calls.some(c => sameRoute(c.key, r.key)) ? 'ok  ' : 'MISS'} ${r.key}${r.public ? '  (public: sign-in)' : ''}`);
  if (untested.length) console.log(`info: never named in ${relative(ROOT, join(ROOT, 'backend/server/scripts/e2e-admin.mjs'))}: ${untested.join(', ')}`);
  console.log(problems.length ? `\n${problems.length} problem(s):\n${problems.map(p => `  - ${p}`).join('\n')}` : '\nadmin page covers every admin API');
}
process.exit(problems.length ? 1 : 0);
