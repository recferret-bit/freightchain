// Feature, flow, controller and route coverage for `npm run test:census -- features`. The map is features.mjs; this file
// only counts. Three sources, each named in the report:
//   static   which tests import a file, which routes a test case requests (supertest calls + the helpers it calls), check() messages
//   e2e      routes the server logged while the browser suites ran (e2e-routes.json, written by `run e2e…`)
//   lines    v8 line coverage of the server and the node:test suites (coverage.json, written by `-- coverage`)
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { FEATURES, FLOWS, SETUP_ROUTES } from './features.mjs';

const HERE = dirname(new URL(import.meta.url).pathname);
export const E2E_ROUTES = join(HERE, 'e2e-routes.json');
export const LINES = join(HERE, 'coverage.json');
export const REPORT_REL = 'docs/testing/test-coverage.md';

const CASE_RE = /(?<![.\w$])(?:it|test)(?:\.(?:each|skip|only|todo|fails|concurrent))?(?:\(\s*(?:['"`({\[]|async\b|function\b)|\([A-Za-z_$])/g;
const METHODS = 'get|post|put|delete|patch';
// The server's request log leaves health probes out (request-log.middleware.ts), so no browser run can show them.
const UNLOGGED = /^GET \/api\/health\//;

function codeOf(text) {
  return text.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' ')).replace(/(^|[^:'"`])\/\/.*$/gm, (m, p) => p + ' '.repeat(m.length - p.length));
}

function listFiles(root, rel = '', acc = []) {
  let names;
  try { names = readdirSync(join(root, rel)); } catch { return acc; }
  for (const name of names) {
    if (name === 'node_modules' || name === 'target' || name === 'dist' || name.startsWith('.')) continue;
    const child = rel ? `${rel}/${name}` : name;
    const st = statSync(join(root, child));
    if (st.isDirectory()) listFiles(root, child, acc);
    else acc.push(child);
  }
  return acc;
}

// ---- routes -------------------------------------------------------------------------------------------------------

export function kebab(cls) {
  return cls.replace(/(Command|Query)$/, '').replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase();
}

export function parseController(rel, text) {
  const prefix = text.match(/@Controller\(\s*(?:'([^']*)')?\s*\)/)?.[1] || '';
  const decos = [...text.matchAll(new RegExp(`@(${METHODS.split('|').map((m) => m[0].toUpperCase() + m.slice(1)).join('|')})\\(\\s*(?:'([^']*)')?\\s*\\)`, 'g'))];
  return decos.map((m, i) => {
    const body = text.slice(m.index, i + 1 < decos.length ? decos[i + 1].index : text.length);
    const path = `/${[prefix, m[2] || ''].filter(Boolean).join('/')}`;
    const method = m[1].toUpperCase();
    return {
      method, path, key: `${method} ${path}`, controller: rel,
      name: body.match(/\n\s+(?:async\s+)?(\w+)\s*\(/)?.[1] || '',
      bus: [...body.matchAll(/new (\w+(?:Command|Query))\(/g)].map((x) => x[1]),
      re: new RegExp(`^${path.replace(/:[^/]+/g, '[^/]+')}$`),
      params: (path.match(/:/g) || []).length,
    };
  });
}

export function matchRoute(routes, method, path) {
  const clean = path.replace(/[?#].*$/, '').replace(/(.)\/$/, '$1');
  const hits = routes.filter((r) => (!method || r.method === method) && r.re.test(clean));
  hits.sort((a, b) => a.params - b.params || b.path.length - a.path.length);
  return hits[0] || null;
}

function normPath(raw) {
  return raw.replace(/\$\{[^}]*\}/g, 'X').replace(/[?#].*$/, '');
}

// Method calls with a literal path: `.post('/api/x')`, `.get(\`/api/rides/${id}\`)`. Paths built by `+` are not seen.
export function requestsIn(code) {
  const out = [];
  for (const m of code.matchAll(new RegExp(`\\.(${METHODS})\\(\\s*(['"\`])`, 'g'))) {
    const q = m[2];
    let i = m.index + m[0].length;
    let s = '';
    while (i < code.length && code[i] !== q) {
      if (q === '`' && code[i] === '$' && code[i + 1] === '{') {
        let depth = 0;
        do { if (code[i] === '{') depth += 1; else if (code[i] === '}') depth -= 1; s += code[i]; i += 1; } while (i < code.length && depth > 0);
        continue;
      }
      s += code[i]; i += 1;
    }
    const at = s.indexOf('/api/');
    // actions.json is the one controller route that is not under /api (blinks discover it at the apex).
    const path = at >= 0 ? normPath(s.slice(at)) : (normPath(s) === '/actions.json' ? '/actions.json' : '');
    if (path) out.push({ method: m[1].toUpperCase(), path });
  }
  return out;
}

// Any /api/ path written in a script, method unknown (the browser harnesses mostly click; this is what they name).
export function pathsNamed(code) {
  return [...code.matchAll(/\/api\/(?:[\w\-./:]|\$\{[^}]*\})*/g)].map((m) => normPath(m[0]));
}

function helperDefs(code) {
  const defs = [];
  for (const m of code.matchAll(/(?:^|\n)[ \t]*(?:export\s+)?(?:async\s+)?function\s*\*?\s*(\w+)\s*[(<]/g)) defs.push({ name: m[1], at: m.index });
  for (const m of code.matchAll(/(?:^|\n|[,{]\s*)[ \t]*(?:export\s+)?(?:const|let)\s+(\w+)\s*=\s*(?:async\s*)?(?:\([^()]*(?:\([^()]*\)[^()]*)*\)|\w+)\s*(?::\s*[^=;\n]+)?=>/g)) defs.push({ name: m[1], at: m.index });
  return defs.sort((a, b) => a.at - b.at);
}

function caseStarts(code) {
  return [...code.matchAll(CASE_RE)].map((m) => m.index);
}

function titleAt(code, at) {
  const open = code.indexOf('(', at);
  const m = code.slice(open + 1, open + 400).match(/^\s*(['"`])((?:\\.|(?!\1)[\s\S])*)\1/);
  return m ? m[2].replace(/\s+/g, ' ') : '';
}

// Routes each helper requests, then closed over the helpers it calls.
function helperRoutes(code, routes, inherited = new Map()) {
  const defs = helperDefs(code);
  const cuts = [...defs.map((d) => d.at), ...caseStarts(code)].sort((a, b) => a - b);
  const local = new Map();
  for (const d of defs) {
    const end = cuts.find((c) => c > d.at) ?? code.length;
    local.set(d.name, code.slice(d.at, end));
  }
  const all = new Map(inherited);
  const direct = new Map();
  for (const [name, body] of local) direct.set(name, { body, keys: keysOf(requestsIn(body), routes) });
  for (const [name, v] of direct) all.set(name, { body: v.body, keys: new Set(v.keys) });
  for (let pass = 0; pass < 4; pass += 1) {
    for (const [name, v] of direct) {
      const keys = all.get(name).keys;
      for (const [other, ov] of all) if (other !== name && callRe(other).test(v.body)) for (const k of ov.keys) keys.add(k);
    }
  }
  return all;
}

// A bare call `name(`, not a method `.name(` – a helper called `post` must not match every `.post(`.
function callRe(name) {
  return new RegExp(`(?<![.\\w$])${name}\\s*\\(`);
}

function keysOf(reqs, routes) {
  const keys = new Set();
  for (const r of reqs) { const hit = matchRoute(routes, r.method, r.path); if (hit) keys.add(hit.key); }
  return keys;
}

export function caseRoutes(text, routes, globalHelpers) {
  const code = codeOf(text);
  const helpers = helperRoutes(code, routes, globalHelpers);
  const starts = caseStarts(code);
  return starts.map((at, i) => {
    const body = code.slice(at, starts[i + 1] ?? code.length);
    const keys = keysOf(requestsIn(body), routes);
    for (const [name, v] of helpers) if (v.keys.size && callRe(name).test(body)) for (const k of v.keys) keys.add(k);
    return { title: titleAt(code, at), keys };
  });
}

// ---- attribution --------------------------------------------------------------------------------------------------

function serverRel(repoRel) {
  return repoRel.startsWith('backend/server/src/') ? repoRel.slice('backend/server/src/'.length) : repoRel.startsWith('server/src/') ? repoRel.slice('server/src/'.length) : null;
}

export function featureOfFile(repoRel) {
  const s = serverRel(repoRel);
  for (const f of FEATURES) {
    if (s !== null ? f.server && f.server.test(s) : f.client && f.client.test(repoRel)) return f.id;
  }
  return null;
}

export function featureOfRoute(key) {
  return FEATURES.find((f) => f.routes && f.routes.test(key))?.id || null;
}

function featureOfWords(title) {
  return FEATURES.find((f) => f.words && f.words.test(title))?.id || null;
}

function featureOfTestPath(rel) {
  return FEATURES.find((f) => f.tests && f.tests.test(rel))?.id || null;
}

// A source file the census counts: logic, not ports / wiring / plain data.
function countedSource(repoRel) {
  const s = serverRel(repoRel);
  if (s !== null) {
    return s.endsWith('.ts') && !s.endsWith('.d.ts') && !/^(application\/ports|presentation)\//.test(s)
      && !/\.(dto|types|command|query|module)\.ts$/.test(s) && !/(^|\/)index\.ts$/.test(s);
  }
  if (/^(?:frontend\/)?client\/(js|site)\/.*\.js$/.test(repoRel)) return true;
  if (/^(?:frontend\/)?landing\/src\/.*\.js$/.test(repoRel)) return true;
  if (/^(?:social\/)?media\/(audio|video)\/.*\.(m?js)$/.test(repoRel) || repoRel === 'social/media/make.mjs' || repoRel === 'media/make.mjs') return true;
  if (/^(?:backend\/)?programs\/.*\/src\/.*\.rs$/.test(repoRel)) return true;
  return false;
}

function sourceInventory(ROOT) {
  const rels = [
    ...listFiles(join(ROOT, 'backend/server/src')).map((r) => `backend/server/src/${r}`),
    ...listFiles(join(ROOT, 'frontend/client/js')).map((r) => `frontend/client/js/${r}`),
    ...listFiles(join(ROOT, 'frontend/client/site')).map((r) => `frontend/client/site/${r}`),
    ...listFiles(join(ROOT, 'frontend/landing/src')).map((r) => `frontend/landing/src/${r}`),
    ...listFiles(join(ROOT, 'social/media/audio')).map((r) => `social/media/audio/${r}`),
    ...listFiles(join(ROOT, 'social/media/video')).map((r) => `social/media/video/${r}`),
    'social/media/make.mjs',
    ...listFiles(join(ROOT, 'backend/programs')).map((r) => `backend/programs/${r}`),
  ];
  return rels.filter(countedSource);
}

export function importsOf(ROOT, rel, text) {
  const out = [];
  for (const m of text.matchAll(/(?:\bfrom\s*|\bimport\s*\(?\s*)['"](\.{1,2}\/[^'"]+)['"]/g)) {
    const abs = resolve(ROOT, dirname(rel), m[1]);
    const tries = [abs, abs.replace(/\.js$/, '.ts'), `${abs}.ts`, `${abs}.js`, `${abs}.mjs`];
    const hit = tries.find((p) => existsSync(p) && statSync(p).isFile());
    if (hit) out.push(relative(ROOT, hit).split('\\').join('/'));
  }
  return out;
}

function stemOf(rel) {
  return basename(rel).replace(/\.(integration\.)?spec\.ts$|\.test\.m?js$|\.(ts|m?js|rs)$/, '');
}

// The file a test is about: the import whose name matches the test's, else a source file of that name anywhere (the pyramid
// audit's basename rule – handler / service specs reach their class through unitContext), else the first import of product code.
export function subjectOf(rel, imports, byStem = new Map()) {
  const stem = stemOf(rel);
  const product = imports.filter((p) => /^((?:backend\/)?server\/src|(?:frontend\/)?client\/(js|site)|(?:frontend\/)?landing\/src|(?:social\/)?media\/(audio|video|make))/.test(p));
  const isServer = (p) => p.startsWith('backend/server/') || p.startsWith('server/');
  const sameSide = (p) => (isServer(rel) ? isServer(p) : !isServer(p));
  const named = (byStem.get(stem) || []).filter(sameSide);
  return product.find((p) => stemOf(p) === stem) || (named.length === 1 ? named[0] : null)
    || product.find((p) => !/\/(shared|support)\//.test(p) && !/\.(dto|types)\.ts$/.test(p)) || null;
}

// ---- checks in the headless playthrough ---------------------------------------------------------------------------

export function headlessChecks(text) {
  const code = codeOf(text);
  const out = [];
  for (const m of code.matchAll(/\bcheck\s*\(/g)) {
    const end = code.indexOf('\n', m.index);
    const next = code.indexOf('check(', m.index + 6);
    out.push(code.slice(m.index, Math.min(end < 0 ? code.length : end, next < 0 ? code.length : next)));
  }
  return out.filter((c) => !/^check\(s\)/.test(c)); // 'check(s)' is the summary message, not a call
}

// The features a case is about. Setup routes do not count when it requests anything else; a race test is named by its title first.
export function attributeCase(c, layer, rowOf) {
  const of = (keys) => new Set(keys.map((k) => rowOf.get(k)?.feature).filter(Boolean));
  const words = featureOfWords(c.title);
  if (layer === 'server-concurrency' && words) return new Set([words]);
  const main = of([...c.keys].filter((k) => !SETUP_ROUTES.has(k)));
  if (main.size) return main;
  if (words) return new Set([words]);
  return of([...c.keys]);
}

// ---- recorded sources ---------------------------------------------------------------------------------------------

function loadJson(path, fallback) {
  try { return JSON.parse(readFileSync(path, 'utf8')); } catch { return fallback; }
}

// Request lines from the e2e server logs → route keys per suite. The server's pretty log puts the JSON fields after the message.
export function routesFromLog(text, routes) {
  const counts = {};
  const unmatched = new Set();
  for (const line of text.split('\n')) {
    const at = line.indexOf('{"event":"request"');
    if (at < 0) continue;
    let row;
    try { row = JSON.parse(line.slice(at)); } catch { continue; }
    const hit = matchRoute(routes, row.method, row.path);
    if (hit) counts[hit.key] = (counts[hit.key] || 0) + 1;
    else unmatched.add(`${row.method} ${row.path}`);
  }
  return { counts, unmatched: [...unmatched].slice(0, 20) };
}

export function recordE2eRoutes(ROOT, dir, at) {
  if (!dir || !existsSync(dir)) return null;
  const routes = allRoutes(ROOT);
  const store = loadJson(E2E_ROUTES, { suites: {} });
  const seen = [];
  for (const name of readdirSync(dir).filter((n) => n.endsWith('.log'))) {
    const suite = name.replace(/\.log$/, '');
    const { counts, unmatched } = routesFromLog(readFileSync(join(dir, name), 'utf8'), routes);
    if (!Object.keys(counts).length) continue;
    store.suites[suite] = { at, routes: counts, unmatched };
    seen.push(suite);
  }
  if (seen.length) writeFileSync(E2E_ROUTES, `${JSON.stringify(store, null, 1)}\n`);
  return seen;
}

// ---- the report ---------------------------------------------------------------------------------------------------

export function allRoutes(ROOT) {
  const dir = join(ROOT, 'backend/server/src/presentation');
  return listFiles(dir).filter((r) => r.endsWith('.controller.ts'))
    .flatMap((r) => parseController(`backend/server/src/presentation/${r}`, readFileSync(join(dir, r), 'utf8')));
}

function useCaseIndex(ROOT) {
  const base = join(ROOT, 'backend/server/src/application/use-cases');
  const idx = new Map();
  for (const rel of listFiles(base).filter((r) => r.endsWith('.handler.ts'))) idx.set(basename(rel, '.handler.ts').replace(/-/g, ''), `backend/server/src/application/use-cases/${rel}`);
  return idx;
}

// ctx: { ROOT, files: census inventory rows { rel, layer, cases, checks }, harnesses: [{ rel, checks, runner }], scenarioSides }
export function featureReport(ctx) {
  const { ROOT, files } = ctx;
  const read = (rel) => readFileSync(join(ROOT, rel), 'utf8');
  const routes = allRoutes(ROOT);
  const handlers = useCaseIndex(ROOT);
  const byLayer = (...ids) => files.filter((f) => ids.includes(f.layer));
  const lines = loadJson(LINES, null);
  const e2e = loadJson(E2E_ROUTES, { suites: {} });

  // Route rows.
  const routeRows = routes.map((r) => {
    const handler = r.bus.map((b) => handlers.get(kebab(b).replace(/-/g, ''))).find(Boolean) || null; // VerifySignInCommand → verify-signin/
    return { ...r, feature: featureOfRoute(r.key), handler, handlerSpec: null, handlerCases: 0, ctrlSpec: false, scenario: 0, scenarioFiles: new Set(), e2eSuites: [], named: [] };
  });
  const rowOf = new Map(routeRows.map((r) => [r.key, r]));

  // Unit / integration / client tests → subject file.
  const subjects = new Map(); // repo file → [{ test, cases }]
  const imported = new Set();
  const testFeature = new Map(); // test rel → feature id
  const unattributed = [];
  const byStem = new Map();
  for (const src of sourceInventory(ROOT)) { const k = stemOf(src); byStem.set(k, [...(byStem.get(k) || []), src]); }
  const unitLike = byLayer('server-domain', 'server-handlers', 'server-services', 'server-infrastructure', 'server-other-unit', 'server-repositories', 'server-integration-other', 'client-unit', 'landing-unit', 'media-unit', 'program');
  for (const f of unitLike) {
    const text = read(f.rel);
    const imps = importsOf(ROOT, f.rel, text);
    for (const p of imps) imported.add(p);
    const subject = f.rel.endsWith('.rs') ? null : subjectOf(f.rel, imps, byStem);
    if (subject) {
      const list = subjects.get(subject) || [];
      list.push({ test: f.rel, cases: f.cases });
      subjects.set(subject, list);
    }
    const feat = featureOfTestPath(f.rel) || (f.layer === 'program' ? 'escrow-program' : null) || (subject ? featureOfFile(subject) : null);
    if (feat) testFeature.set(f.rel, feat);
    else unattributed.push(f.rel);
  }

  // Controller specs: which handler methods they call.
  for (const ctrl of new Set(routes.map((r) => r.controller))) {
    const spec = files.find((f) => f.layer === 'server-controllers' && stemOf(f.rel) === stemOf(ctrl));
    if (!spec) continue;
    const code = codeOf(read(spec.rel));
    for (const r of routeRows.filter((x) => x.controller === ctrl)) r.ctrlSpec = new RegExp(`\\.${r.name}\\s*\\(`).test(code);
  }
  for (const r of routeRows) {
    if (!r.handler) continue;
    const spec = (subjects.get(r.handler) || [])[0];
    if (spec) { r.handlerSpec = spec.test; r.handlerCases = spec.cases; }
  }

  // Scenario / HTTP / integration cases → routes; concurrency cases by title when they request nothing.
  const globalHelpers = new Map();
  for (const rel of listFiles(join(ROOT, 'backend/server/test/support')).filter((r) => r.endsWith('.ts'))) {
    for (const [k, v] of helperRoutes(codeOf(read(`backend/server/test/support/${rel}`)), routes)) globalHelpers.set(k, v);
  }
  const caseFeatures = []; // { file, layer, title, features:Set }
  for (const f of byLayer('server-scenarios', 'server-http', 'server-concurrency', 'server-integration-other', 'server-audits')) {
    const cases = caseRoutes(read(f.rel), routes, globalHelpers);
    for (const c of cases) {
      for (const k of c.keys) {
        const row = rowOf.get(k);
        if (f.layer === 'server-scenarios' || f.layer === 'server-http') { row.scenario += 1; row.scenarioFiles.add(f.rel); }
      }
      const feats = attributeCase(c, f.layer, rowOf);
      caseFeatures.push({ file: f.rel, layer: f.layer, title: c.title, features: feats, keys: c.keys });
    }
  }

  // Browser harnesses: what each one names, and what the server logged while the suites ran.
  for (const h of ctx.harnesses) {
    const code = codeOf(read(h.rel));
    for (const p of pathsNamed(code)) { const hit = matchRoute(routes, null, p); if (hit && !rowOf.get(hit.key).named.includes(basename(h.rel))) rowOf.get(hit.key).named.push(basename(h.rel)); }
  }
  const suites = Object.entries(e2e.suites || {});
  for (const [suite, rec] of suites) for (const k of Object.keys(rec.routes || {})) if (rowOf.has(k)) rowOf.get(k).e2eSuites.push(suite);

  // Headless checks.
  const headless = headlessChecks(read('frontend/client/tools/headless-test.mjs')).map((c) => ({ text: c, feature: FEATURES.find((f) => f.headless && f.headless.test(c))?.id || null }));

  // Source files per feature.
  const sources = sourceInventory(ROOT);
  const unmapped = [];
  const lineOf = (rel) => lines?.files?.[rel] || null;
  const featureRows = FEATURES.map((feat) => {
    const own = sources.filter((s) => featureOfFile(s) === feat.id);
    const withTest = own.filter((s) => subjects.has(s));
    const unit = [...testFeature.entries()].filter(([, id]) => id === feat.id).map(([rel]) => files.find((x) => x.rel === rel));
    const unitCases = unit.reduce((n, f) => n + f.cases, 0);
    const featRoutes = routeRows.filter((r) => r.feature === feat.id);
    const hit = featRoutes.filter((r) => r.scenario > 0);
    const cases = caseFeatures.filter((c) => c.features.has(feat.id));
    const scenarioCases = cases.filter((c) => c.layer === 'server-scenarios' || c.layer === 'server-http').length;
    const race = cases.filter((c) => c.layer === 'server-concurrency').length;
    const repoSpecs = unit.filter((f) => f.layer === 'server-repositories').length;
    const sim = headless.filter((h) => h.feature === feat.id).length;
    const harness = (feat.e2e || []).map((name) => ctx.harnesses.find((h) => basename(h.rel) === name)).filter(Boolean);
    const loggable = featRoutes.filter((r) => !UNLOGGED.test(r.key));
    const e2eRouteHits = loggable.filter((r) => r.e2eSuites.length).length;
    const e2eSuites = [...new Set(featRoutes.flatMap((r) => r.e2eSuites))];
    let lineCov = null;
    if (lines?.files) {
      const sum = [0, 0, 0, 0];
      let seen = 0;
      for (const s of own) { const l = lineOf(s); if (l) { l.forEach((n, i) => { sum[i] += n || 0; }); seen += 1; } }
      if (sum[1]) lineCov = { pct: pct(sum.slice(0, 2)), branches: pct(sum.slice(2, 4)), seen, of: own.length };
    }
    const row = {
      id: feat.id, title: feat.title, files: own.length, withTest: withTest.length, untested: own.filter((s) => !subjects.has(s)),
      unitFiles: unit.length, unitCases, routes: featRoutes.length, routesHit: hit.length, scenarioCases, race, repoSpecs, sim,
      harness: harness.map((h) => ({ name: basename(h.rel), checks: h.checks, runner: h.runner })), skills: feat.skills || [],
      recordable: harness.some((h) => h.runner === 'e2e.sh'),
      e2eRouteHits, e2eRoutes: loggable.length, e2eSuites, lines: lineCov,
      unrecorded: harness.filter((h) => h.runner !== 'e2e.sh').map((h) => basename(h.rel).replace(/\.mjs$/, '')),
    };
    row.grade = gradeFeature(row, suites.length > 0);
    return row;
  });
  for (const s of sources) if (!featureOfFile(s)) unmapped.push(s);

  // Flows.
  const flowRows = FLOWS.map((flow) => {
    const steps = flow.steps.map((st) => {
      if (typeof st !== 'string') return { note: st.note };
      const r = rowOf.get(st);
      return r ? { key: st, scenario: r.scenario, e2e: r.e2eSuites, named: r.named } : { key: st, missing: true };
    });
    const routed = steps.filter((s) => s.key && !s.missing);
    return {
      id: flow.id, title: flow.title, steps,
      total: routed.length,
      inScenario: routed.filter((s) => s.scenario > 0).length,
      inE2e: routed.filter((s) => s.e2e.length).length,
      named: routed.filter((s) => s.named.length).length,
      unknown: steps.filter((s) => s.missing).map((s) => s.key),
      none: routed.filter((s) => !s.scenario && !s.e2e.length).map((s) => s.key),
      suites: [...new Set(routed.flatMap((s) => s.e2e))],
    };
  });

  // Controllers.
  const ctrlRows = [...new Set(routes.map((r) => r.controller))].map((ctrl) => {
    const rs = routeRows.filter((r) => r.controller === ctrl);
    const spec = files.find((f) => f.layer === 'server-controllers' && stemOf(f.rel) === stemOf(ctrl));
    return {
      controller: ctrl, name: basename(ctrl, '.http.controller.ts'), routes: rs.length,
      specCases: spec ? spec.cases : 0, dispatched: rs.filter((r) => r.ctrlSpec).length,
      handlersWithSpec: rs.filter((r) => r.handlerSpec).length, handlers: rs.filter((r) => r.handler).length,
      inScenario: rs.filter((r) => r.scenario > 0).length, inE2e: rs.filter((r) => r.e2eSuites.length).length,
      named: rs.filter((r) => r.named.length).length,
      lines: lines?.files ? pct(lines.files[ctrl]) : null,
    };
  });

  return {
    routes: routeRows, features: featureRows, flows: flowRows, controllers: ctrlRows, headless, unmapped, unattributed,
    e2eRecorded: suites.map(([suite, rec]) => ({ suite, at: rec.at, routes: Object.keys(rec.routes).length })),
    lines: lines ? { at: lines.at, scope: lines.scope } : null, lineOf,
  };
}

function pct(pair) {
  return pair && pair[1] ? Math.round((pair[0] / pair[1]) * 1000) / 10 : null;
}

function linesAndBranches(rec) {
  if (!rec) return '—';
  const b = pct(rec.slice(2, 4));
  return `${pct(rec)} %${b == null ? '' : ` · ${b} %`}`;
}

// The grading rule, printed with the table. No composite score: each missing layer is named.
export const GRADE_RULE = [
  '`strong` = nothing below is missing. `fair` = one thing is. `thin` = two or more, or fewer than a quarter of its files have a test of their own and no headless check stands in. `untested` = no test reaches it.',
  'Checked: half or more of its source files are the subject of a test of their own (waived when the headless playthrough has 5+ checks for it, or for the Rust program, whose tests are black-box);',
  'every API route it owns is requested by at least one HTTP scenario; a browser / API harness or a test skill drives it end to end;',
  'when browser runs are recorded and one of its harnesses is an `e2e.sh` suite, every route it owns was hit by one (localnet and the tickets stub are not recorded); when line coverage is recorded, at least 70 % of its lines and 60 % of its branches ran (over the files a test loaded).',
];

export function gradeFeature(row, e2eRecorded) {
  const miss = [];
  const anyTest = row.unitFiles || row.scenarioCases || row.race || row.sim || row.harness.length;
  if (!anyTest) return { grade: 'untested', miss: ['no test reaches it'] };
  const waived = row.sim >= 5 || row.id === 'escrow-program';
  if (row.files && !waived && row.withTest / row.files < 0.5) miss.push(`${row.files - row.withTest} of ${row.files} files have no test of their own`);
  if (row.routes && row.routesHit < row.routes) miss.push(`${row.routes - row.routesHit} of ${row.routes} routes in no scenario`);
  if (!row.harness.length && !row.skills.length) miss.push('no end-to-end harness');
  // Only e2e.sh suites are recorded: localnet and the tickets stub run outside it, so their features are not judged on this.
  const logged = row.e2eRoutes ?? row.routes;
  if (e2eRecorded && logged && row.recordable && row.e2eRouteHits < logged) {
    const also = row.unrecorded?.length ? ` (${row.unrecorded.join(', ')} not recorded)` : '';
    miss.push(`${logged - row.e2eRouteHits} of ${logged} routes never hit in a recorded browser run${also}`);
  }
  if (row.lines && row.lines.pct < 70) miss.push(`${row.lines.pct} % of lines ran`);
  if (row.lines && row.lines.branches != null && row.lines.branches < 60) miss.push(`${row.lines.branches} % of branches ran`);
  const bare = row.files >= 4 && !waived && row.withTest / row.files < 0.25;
  const grade = miss.length === 0 ? 'strong' : miss.length === 1 && !bare ? 'fair' : 'thin';
  return { grade, miss };
}

// ---- markdown -----------------------------------------------------------------------------------------------------

const cell = (s) => String(s).replace(/\|/g, '/').replace(/\n/g, ' ');
const frac = (a, b) => (b ? `${a}/${b}` : '—');
const linePct = (l) => (l ? `${l.pct} % · ${l.branches ?? '—'} %${l.seen < l.of ? ` (${l.seen}/${l.of} files loaded)` : ''}` : '—');

export function featureTable(rep) {
  const lines = [];
  lines.push('| Feature | Grade | Files with own test | Unit cases | Routes in scenarios | Scenario cases | Race tests | Sim checks | Harnesses | Routes in recorded e2e.sh runs | Lines · branches | Missing |');
  lines.push('| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | --- | ---: | ---: | --- |');
  for (const f of rep.features) {
    const harness = [...f.harness.map((h) => h.name.replace(/\.mjs$/, '')), ...(f.harness.length ? [] : f.skills.map((s) => `/${s}`))].join(', ') || '—';
    lines.push(`| ${cell(f.title)} | **${f.grade.grade}** | ${frac(f.withTest, f.files)} | ${f.unitCases} | ${frac(f.routesHit, f.routes)} | ${f.routes ? f.scenarioCases : '—'} | ${f.race || '—'} | ${f.sim || '—'} | ${cell(harness)} | ${rep.e2eRecorded.length && f.e2eRoutes && f.recordable ? frac(f.e2eRouteHits, f.e2eRoutes) : '—'} | ${linePct(f.lines)} | ${cell(f.grade.miss.join('; ') || '—')} |`);
  }
  return lines;
}

export function flowTable(rep) {
  const lines = [];
  const recorded = rep.e2eRecorded.length > 0;
  lines.push(`| Flow | Route steps | In scenarios | ${recorded ? 'In browser runs' : 'Named by a harness'} | Reached by no test |`);
  lines.push('| --- | ---: | ---: | ---: | --- |');
  for (const f of rep.flows) {
    const none = f.none.length ? f.none.map((k) => `\`${k}\``).join(', ') : '—';
    lines.push(`| ${cell(f.title)} | ${f.total} | ${frac(f.inScenario, f.total)} | ${frac(recorded ? f.inE2e : f.named, f.total)} | ${cell(none)}${f.unknown.length ? ` (unknown step: ${f.unknown.join(', ')})` : ''} |`);
  }
  return lines;
}

export function controllerTable(rep) {
  const lines = [];
  const recorded = rep.e2eRecorded.length > 0;
  lines.push(`| Controller | Routes | Spec cases | Routes the spec dispatches | Handlers with a spec | Routes in scenarios | ${recorded ? 'Routes in browser runs' : 'Routes a harness names'} | Lines |`);
  lines.push('| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |');
  for (const c of rep.controllers) {
    lines.push(`| \`${c.name}\` | ${c.routes} | ${c.specCases} | ${frac(c.dispatched, c.routes)} | ${frac(c.handlersWithSpec, c.handlers)} | ${frac(c.inScenario, c.routes)} | ${frac(recorded ? c.inE2e : c.named, c.routes)} | ${c.lines == null ? '—' : `${c.lines} %`} |`);
  }
  return lines;
}

function routeTable(rep) {
  const lines = [];
  lines.push('| Route | Feature | Handler spec cases | Controller spec | Scenario cases | Browser runs | Named by | Handler lines · branches |');
  lines.push('| --- | --- | ---: | :---: | ---: | --- | --- | ---: |');
  for (const r of rep.routes) {
    lines.push(`| \`${r.key}\` | ${r.feature || '—'} | ${r.handler ? (r.handlerSpec ? r.handlerCases : '**none**') : '—'} | ${r.ctrlSpec ? 'yes' : '**no**'} | ${r.scenario || '**0**'} | ${r.e2eSuites.join(', ') || '—'} | ${r.named.map((n) => n.replace(/\.mjs$/, '')).join(', ') || '—'} | ${r.handler ? linesAndBranches(rep.lineOf(r.handler)) : '—'} |`);
  }
  return lines;
}

export function sourceLine(rep) {
  const parts = ['Static: imports, requested routes, `check()` messages'];
  if (rep.e2eRecorded.length) parts.push(`browser runs: ${rep.e2eRecorded.map((s) => `\`${s.suite}\` ${s.at.slice(0, 10)}`).join(', ')}`);
  else parts.push('browser runs: none recorded (`npm run test:census -- run e2e`)');
  parts.push(rep.lines ? `lines: ${rep.lines.scope} at ${rep.lines.at.slice(0, 16).replace('T', ' ')} UTC` : 'lines: not recorded (`npm run test:census -- coverage`)');
  return `${parts.join(' · ')}.`;
}

export function renderFull(rep, countedAt) {
  const out = [];
  out.push('# Test coverage by feature');
  out.push('');
  out.push(`Generated ${countedAt.slice(0, 16).replace('T', ' ')} UTC by \`npm run test:census -- features --write\` (skill \`test-census\`). Do not edit by hand: the map is \`.claude/skills/test-census/features.mjs\`.`);
  out.push('');
  out.push(sourceLine(rep));
  out.push('');
  out.push('## Features');
  out.push('');
  out.push(...GRADE_RULE);
  out.push('');
  out.push(...featureTable(rep));
  out.push('');
  out.push('Columns: *files with own test* = source files (logic only: no ports, DTOs, commands / queries, modules) that a test imports as its subject. *Scenario cases* = HTTP scenario / HTTP spec cases that request one of its routes, setup calls included, so sign-in and ride creation are reached by almost every case. *Race tests* = concurrency cases on PostgreSQL. *Sim checks* = headless playthrough `check()` calls. *Routes in recorded e2e.sh runs* = routes the server logged while the recorded `run-tests/e2e.sh` suites ran (— when no harness of the feature runs there; health probes are not logged, so they are left out).');
  out.push('');
  out.push('## User flows');
  out.push('');
  out.push(...flowTable(rep));
  out.push('');
  for (const f of rep.flows) {
    out.push(`<details><summary>${cell(f.title)}</summary>`);
    out.push('');
    out.push('| Step | Scenario cases | Browser runs | Named by |');
    out.push('| --- | ---: | --- | --- |');
    for (const s of f.steps) {
      if (s.note) out.push(`| *${cell(s.note)}* | | | |`);
      else if (s.missing) out.push(`| \`${s.key}\` (no such route) | | | |`);
      else out.push(`| \`${s.key}\` | ${s.scenario || '**0**'} | ${s.e2e.join(', ') || '—'} | ${s.named.map((n) => n.replace(/\.mjs$/, '')).join(', ') || '—'} |`);
    }
    out.push('');
    out.push('</details>');
    out.push('');
  }
  out.push('## Controllers');
  out.push('');
  out.push(...controllerTable(rep));
  out.push('');
  out.push('## Routes');
  out.push('');
  out.push(...routeTable(rep));
  out.push('');
  out.push('## Files with no test of their own, by feature');
  out.push('');
  for (const f of rep.features.filter((x) => x.untested.length)) {
    const shown = f.untested.map((p) => {
      const l = pct(rep.lineOf(p));
      return `\`${p.replace(/^(?:backend\/)?server\/src\//, '')}\`${l == null ? '' : ` (${l} % lines)`}`;
    });
    out.push(`- **${cell(f.title)}** (${f.untested.length}): ${shown.join(', ')}`);
  }
  out.push('');
  const simOther = rep.headless.filter((h) => !h.feature).length;
  out.push('## Map hygiene');
  out.push('');
  out.push(`- Source files no feature claims: ${rep.unmapped.length ? rep.unmapped.map((p) => `\`${p}\``).join(', ') : 'none'}.`);
  out.push(`- Tests attributed to no feature: ${rep.unattributed.length ? rep.unattributed.map((p) => `\`${p}\``).join(', ') : 'none'}.`);
  out.push(`- Headless checks no feature claims: ${simOther ? rep.headless.filter((h) => !h.feature).map((h) => `\`${cell(h.text.slice(0, 90))}\``).join(', ') : 'none'}.`);
  out.push('');
  return out.join('\n');
}

export function writeFull(ROOT, rep, countedAt) {
  writeFileSync(join(ROOT, REPORT_REL), `${renderFull(rep, countedAt)}\n`);
  return REPORT_REL;
}

// ---- line coverage ------------------------------------------------------------------------------------------------

// Istanbul JSON (vitest v8) → per file [covered lines, lines, covered branches, branches]; a line counts once when any statement on it ran.
export function linesFromIstanbul(json, ROOT) {
  const out = {};
  for (const [abs, data] of Object.entries(json)) {
    const rel = relative(ROOT, data.path || abs).split('\\').join('/');
    const seen = new Map();
    for (const [id, loc] of Object.entries(data.statementMap || {})) {
      const line = loc.start.line;
      seen.set(line, (seen.get(line) || 0) + (data.s?.[id] || 0));
    }
    const arms = Object.values(data.b || {}).flat();
    out[rel] = [[...seen.values()].filter((n) => n > 0).length, seen.size, arms.filter((n) => n > 0).length, arms.length];
  }
  return out;
}

export function mergeIstanbul(a, b) {
  const out = { ...a };
  for (const [k, v] of Object.entries(b)) {
    if (!out[k]) { out[k] = v; continue; }
    const s = { ...out[k].s };
    for (const [id, n] of Object.entries(v.s || {})) s[id] = (s[id] || 0) + n;
    const b = { ...out[k].b };
    for (const [id, arms] of Object.entries(v.b || {})) b[id] = arms.map((n, i) => n + (b[id]?.[i] || 0));
    out[k] = { ...out[k], s, b };
  }
  return out;
}

// node:test lcov → `acc` (several suites hit the same file: hits add up). SF paths are relative to the package the tests ran in (`base`).
export function addLcov(acc, text, ROOT, base = ROOT) {
  let rec = null;
  for (const line of text.split('\n')) {
    if (line.startsWith('SF:')) {
      const file = relative(ROOT, resolve(base, line.slice(3))).split('\\').join('/');
      rec = file.startsWith('..') || /\/(test|tools|node_modules)\/|\/\.census-/.test(`/${file}`) ? null : (acc[file] ||= { lines: new Map(), arms: new Map() });
    } else if (!rec) continue;
    else if (line.startsWith('DA:')) { const [n, c] = line.slice(3).split(','); rec.lines.set(n, (rec.lines.get(n) || 0) + Number(c)); }
    else if (line.startsWith('BRDA:')) {
      const [n, block, branch, taken] = line.slice(5).split(',');
      const key = `${n},${block},${branch}`;
      rec.arms.set(key, (rec.arms.get(key) || 0) + (taken === '-' ? 0 : Number(taken)));
    }
  }
  return acc;
}

export function linesFromLcov(acc) {
  const out = {};
  const hit = (m) => [...m.values()].filter((n) => n > 0).length;
  for (const [file, rec] of Object.entries(acc)) out[file] = [hit(rec.lines), rec.lines.size, hit(rec.arms), rec.arms.size];
  return out;
}

export function saveLines(files, scope) {
  writeFileSync(LINES, `${JSON.stringify({ at: new Date().toISOString(), scope, files }, null, 0).replace(/\],"/g, '],\n"')}\n`);
}
