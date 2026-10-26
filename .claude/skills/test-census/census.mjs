#!/usr/bin/env node
// Counts Freight Chain's tests by pyramid layer, lists the test skills, names gaps,
// and (on `run`) times stages into runs.json. `readme` rewrites the marker block in README.md.
// The missing-spec rule is the one in server/test/architecture/test-pyramid.spec.ts. If they disagree, the spec is right.
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, unlinkSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  addLcov, allRoutes, attributeCase, caseRoutes, gradeFeature, matchRoute, parseController, requestsIn, routesFromLog, subjectOf, controllerTable, featureReport, featureTable, flowTable, GRADE_RULE, linesFromIstanbul, linesFromLcov, mergeIstanbul,
  recordE2eRoutes, renderFull, REPORT_REL, saveLines, sourceLine, writeFull,
} from './coverage.mjs';
import { FEATURES } from './features.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '../../..');
const RUNS = join(HERE, 'runs.json');
const README = join(ROOT, 'README.md');
const START = '<!-- test-census:start -->';
const END = '<!-- test-census:end -->';
const KEEP = 12;
const SHOW = 24;
const KILL_GRACE_MS = 2000;

const LAYERS = [
  ['server-domain', 'unit', 'Server domain', 'npm run server:test'],
  ['server-handlers', 'unit', 'Server CQRS handlers', 'npm run server:test'],
  ['server-services', 'unit', 'Server services', 'npm run server:test'],
  ['server-controllers', 'unit', 'Server controllers', 'npm run server:test'],
  ['server-infrastructure', 'unit', 'Server infrastructure', 'npm run server:test'],
  ['server-other-unit', 'unit', 'Server app, cli, support', 'npm run server:test'],
  ['client-unit', 'unit', 'Client unit', 'cd client && npm run test:unit'],
  ['landing-unit', 'unit', 'Landing', 'npm run landing:test'],
  ['media-unit', 'unit', 'Media', 'npm run media:check'],
  ['program', 'unit', 'Escrow program (host tests)', 'npm run program:test'],
  ['server-audits', 'audit', 'Architecture and migration SQL', 'npm run server:test'],
  ['server-scenarios', 'contract', 'HTTP scenarios (source)', 'server:test and server:integration'],
  ['server-http', 'contract', 'HTTP specs, in-memory', 'npm run server:test'],
  ['server-repositories', 'integration', 'Repositories on PostgreSQL', 'npm run server:integration'],
  ['server-concurrency', 'integration', 'Concurrency', 'npm run server:integration'],
  ['server-migration-drift', 'integration', 'Migration drift', 'npm run server:integration'],
  ['server-http-postgres', 'integration', 'Same HTTP scenarios on PostgreSQL', 'npm run server:integration'],
  ['server-integration-other', 'integration', 'Other PostgreSQL specs', 'npm run server:integration'],
  ['client-headless', 'sim', 'Headless game playthrough', 'cd client && npm run test:headless'],
  ['browser-e2e', 'e2e', 'Browser and API harnesses', 'bash .claude/skills/run-tests/e2e.sh'],
];

const FAST = ['client-unit', 'landing', 'media', 'client-headless', 'server-unit', 'server-integration', 'program-test'];
const E2E_SUITES = ['browser', 'lobby', 'admin', 'promo', 'watch', 'replay', 'flags', 'wallet', 'wallet-split', 'board', 'close', 'close-split', 'verified', 'verified-deep'];
const OPT_IN = ['e2e', 'live-board', 'replay', 'verified', 'localnet', 'posthog', 'program-check', ...E2E_SUITES.map((s) => `e2e:${s}`)];

// A test skill's census stage. A skill whose name marks it as a test but is missing here is reported as a gap.
const SKILL_STAGE = {
  'run-tests': 'e2e',
  'live-board-test': 'live-board',
  'replay-test': 'replay',
  'verified-play-test': 'verified',
  'localnet-e2e': 'localnet',
  'posthog-test': 'posthog',
  'program-check': 'program-check',
};

const SKIP_DIR = new Set(['node_modules', 'target', 'dist', '.git', 'coverage', '.next']);

function walk(dir, rel, acc) {
  let names;
  try { names = readdirSync(dir); } catch { return; }
  for (const name of names) {
    if (name.startsWith('.e2e-build') || name.startsWith('.e2e-tsconfig')) continue;
    const full = join(dir, name);
    const child = rel ? `${rel}/${name}` : name;
    let st;
    try { st = statSync(full); } catch { continue; }
    if (st.isDirectory()) {
      // .claude holds skills plus other checkouts under worktrees. Those copies are not this tree's suite.
      if (SKIP_DIR.has(name) || name === '.claude' || (name === 'out' && (rel === 'media' || rel === 'social/media'))) continue;
      walk(full, child, acc);
    } else if (st.size < 1_500_000) acc.push(child);
  }
}

function read(rel) {
  return readFileSync(join(ROOT, rel), 'utf8');
}

// Same comment strip as server/test/architecture/source-files.ts. Case counts must ignore prose.
function codeOf(text) {
  return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1');
}

// Drop string contents so a message such as "check(s)" is not a call. A ${...} interpolation stays.
function stripStrings(code) {
  let out = '';
  let i = 0;
  const skipString = (q) => {
    i += 1;
    while (i < code.length) {
      const c = code[i];
      if (c === '\\') { i += 2; continue; }
      if (q === '`' && c === '$' && code[i + 1] === '{') {
        i += 2;
        let depth = 1;
        while (i < code.length && depth > 0) {
          const d = code[i];
          if (d === '\\') { out += d + (code[i + 1] || ''); i += 2; continue; }
          if (d === "'" || d === '"' || d === '`') { out += ' '; skipString(d); continue; }
          if (d === '{') depth += 1;
          else if (d === '}') {
            depth -= 1;
            if (depth === 0) { i += 1; break; }
          }
          out += d;
          i += 1;
        }
        continue;
      }
      i += 1;
      if (c === q) return;
    }
  };
  while (i < code.length) {
    const c = code[i];
    if (c === "'" || c === '"' || c === '`') { out += ' '; skipString(c); continue; }
    out += c;
    i += 1;
  }
  return out;
}

function countCalls(rel, text) {
  if (rel.endsWith('.rs')) {
    const n = (codeOf(text).match(/#\[(?:tokio::)?test(?:\([^)]*\))?\]/g) || []).length;
    return { cases: n, each: 0, checks: 0 };
  }
  const code = codeOf(text);
  let cases = 0;
  let each = 0;
  // A call. A quoted or bracketed argument may be on the next line. An identifier
  // argument (`it(r.name)`) must sit against the parenthesis, so "it (the …)" in a name is not a call.
  // RegExp `.test(` is not a call either.
  for (const m of code.matchAll(/(?<![.\w$])(?:it|test)(?:\.(?:each|skip|only|todo|fails|concurrent))?(?:\(\s*(?:['"`({\[]|async\b|function\b)|\([A-Za-z_$])/g)) {
    cases += 1;
    if (m[0].includes('.each')) each += 1;
  }
  const checks = (stripStrings(code).match(/\bcheck\s*\(/g) || []).length;
  return { cases, each, checks };
}

function layerOf(rel) {
  if (rel.startsWith('backend/server/test/unit/domain/')) return 'server-domain';
  if (rel.startsWith('backend/server/test/unit/application/use-cases/')) return 'server-handlers';
  if (rel.startsWith('backend/server/test/unit/application/services/')) return 'server-services';
  if (rel.startsWith('backend/server/test/unit/presentation/')) return 'server-controllers';
  if (rel.startsWith('backend/server/test/unit/infrastructure/')) return 'server-infrastructure';
  if (rel.startsWith('backend/server/test/unit/') && rel.endsWith('.spec.ts')) return 'server-other-unit';
  if ((rel.startsWith('backend/server/test/architecture/') || rel.startsWith('backend/server/test/migrations/')) && rel.endsWith('.spec.ts')) return 'server-audits';
  if (rel.startsWith('backend/server/test/scenarios/') && rel.endsWith('.ts')) return 'server-scenarios';
  if (rel.startsWith('backend/server/test/http/') && rel.endsWith('.spec.ts')) return 'server-http';
  if (rel.startsWith('backend/server/test/integration/repositories/') && rel.endsWith('.spec.ts')) return 'server-repositories';
  if (rel.endsWith('concurrency.integration.spec.ts')) return 'server-concurrency';
  if (rel.endsWith('migrations.integration.spec.ts')) return 'server-migration-drift';
  if (rel.endsWith('flows.integration.spec.ts')) return 'server-http-postgres';
  if (rel.startsWith('backend/server/test/integration/') && rel.endsWith('.spec.ts')) return 'server-integration-other';
  if (rel.startsWith('frontend/client/test/') && rel.endsWith('.test.mjs')) return 'client-unit';
  if (rel === 'frontend/client/tools/headless-test.mjs') return 'client-headless';
  if (/^(frontend\/client\/tools|frontend\/landing\/tools|backend\/server\/scripts)\/e2e-.*\.mjs$/.test(rel)) return 'browser-e2e';
  if (rel.startsWith('frontend/landing/test/') && rel.endsWith('.test.js')) return 'landing-unit';
  if (rel.startsWith('social/media/test/') && rel.endsWith('.test.mjs')) return 'media-unit';
  if (rel.startsWith('backend/programs/') && rel.endsWith('.rs')) return 'program';
  return null;
}

function interesting(rel) {
  if (rel.startsWith('backend/server/test/') && (rel.endsWith('.spec.ts') || rel.startsWith('backend/server/test/scenarios/'))) return rel.endsWith('.ts');
  if (rel.startsWith('frontend/client/test/') && rel.endsWith('.test.mjs')) return true;
  if (rel === 'frontend/client/tools/headless-test.mjs') return true;
  if (/^(frontend\/client\/tools|frontend\/landing\/tools|backend\/server\/scripts)\/e2e-.*\.mjs$/.test(rel)) return true;
  if (rel.startsWith('frontend/landing/test/') && rel.endsWith('.test.js')) return true;
  if (rel.startsWith('social/media/test/') && rel.endsWith('.test.mjs')) return true;
  if (rel.startsWith('backend/programs/') && rel.endsWith('.rs') && !rel.includes('/target/')) return true;
  return false;
}

function basenamesUnder(relDir) {
  const found = new Set();
  const abs = join(ROOT, relDir);
  const walkDir = (dir) => {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      if (statSync(full).isDirectory()) walkDir(full);
      else found.add(name);
    }
  };
  walkDir(abs);
  return found;
}

function srcFiles() {
  const acc = [];
  const src = join(ROOT, 'backend/server/src');
  const walkSrc = (dir) => {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      if (statSync(full).isDirectory()) walkSrc(full);
      else if (name.endsWith('.ts') && !name.endsWith('.d.ts')) {
        const path = full.slice(src.length + 1).split('\\').join('/');
        acc.push({ path, text: readFileSync(full, 'utf8') });
      }
    }
  };
  walkSrc(src);
  return acc;
}

// Mirrors test-pyramid.spec.ts. Filename match is by basename, on purpose: that is what the audit does.
function pyramidGaps(sources, unitSpecs, integrationSpecs, purePaths) {
  const nestRe = /@(Injectable|Controller|CommandHandler|QueryHandler|Catch)\(/;
  const talks = (path, text) => path.startsWith('infrastructure/prisma/') || (/PrismaService/.test(text) && path.startsWith('infrastructure/'));
  const nest = sources.filter((f) => nestRe.test(f.text));
  const needsIntegration = nest.filter((f) => talks(f.path, f.text));
  const needsUnit = nest.filter((f) => !needsIntegration.includes(f));
  const stem = (path) => path.split('/').pop().replace(/\.ts$/, '');
  return {
    missingUnit: needsUnit.filter((f) => !unitSpecs.has(`${stem(f.path)}.spec.ts`)).map((f) => f.path),
    missingIntegration: needsIntegration.filter((f) => !integrationSpecs.has(`${stem(f.path)}.integration.spec.ts`)).map((f) => f.path),
    missingPure: purePaths.filter((p) => !unitSpecs.has(`${stem(p)}.spec.ts`)),
  };
}

function pureModulePaths(specText) {
  const m = specText.match(/for \(const path of \[([\s\S]*?)\]\)/);
  if (!m) return null;
  return [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]);
}

function scenarioFns(text) {
  return [...text.matchAll(/export function (\w*Scenarios)\b/g)].map((m) => m[1]);
}

// References outside import lines. A scenario passed into the suite list and called again counts twice.
function mentions(text, name) {
  const code = codeOf(text).split('\n').filter((line) => !/^\s*import\b/.test(line)).join('\n');
  return [...code.matchAll(new RegExp(`\\b${name}\\b`, 'g'))].length;
}

function skillKind(name) {
  if (name === 'test-census') return 'census';
  if (name === 'run-tests' || name === 'program-check' || name.endsWith('-test') || name.endsWith('-e2e')) return 'test';
  if (name === 'posthog-prod' || name.startsWith('prod-') || name === 'ride-investigate' || name === 'ride-audit') return 'prod-read';
  return 'other';
}

function frontmatter(text) {
  const block = text.match(/^---\n([\s\S]*?)\n---/);
  if (!block) return { name: '', description: '' };
  const body = block[1];
  const name = (body.match(/^name:\s*(.+)$/m)?.[1] || '').trim();
  const lines = body.split('\n');
  const i = lines.findIndex((l) => l.startsWith('description:'));
  if (i < 0) return { name, description: '' };
  const rest = lines[i].slice('description:'.length).trim();
  if (rest && rest !== '>' && rest !== '|' && rest !== '>-' && rest !== '|-') return { name, description: rest.replace(/^['"]|['"]$/g, '') };
  const chunk = [];
  for (const line of lines.slice(i + 1)) {
    if (/^\S/.test(line)) break;
    chunk.push(line.trim());
  }
  return { name, description: chunk.join(' ') };
}

function firstCommand(text) {
  const fence = text.match(/```(?:sh|bash)\n([\s\S]*?)```/);
  if (!fence) return '';
  const line = fence[1].split('\n').map((l) => l.trim()).find((l) => l && !l.startsWith('#'));
  return line || '';
}

function loadSkills() {
  const root = join(ROOT, '.claude/skills');
  const skills = [];
  for (const name of readdirSync(root)) {
    const file = join(root, name, 'SKILL.md');
    if (!existsSync(file)) continue;
    const text = readFileSync(file, 'utf8');
    const fm = frontmatter(text);
    skills.push({
      name: fm.name || name,
      kind: skillKind(fm.name || name),
      command: firstCommand(text),
      stage: SKILL_STAGE[fm.name || name] || '',
    });
  }
  skills.sort((a, b) => (a.name < b.name ? -1 : 1));
  return skills;
}

function dirHas(dir, needle, ext) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      if (dirHas(full, needle, ext)) return true;
    } else if (ext.test(name) && readFileSync(full, 'utf8').includes(needle)) return true;
  }
  return false;
}

// e2e.sh wins, then a skill's shell runner, then a package.json script. Prose in SKILL.md is not a runner.
function runnerFor(base) {
  if (read('.claude/skills/run-tests/e2e.sh').includes(base)) return 'e2e.sh';
  const skills = join(ROOT, '.claude/skills');
  for (const name of readdirSync(skills)) {
    if (name === 'test-census') continue;
    const dir = join(skills, name);
    if (!statSync(dir).isDirectory()) continue;
    if (dirHas(dir, base, /\.sh$/)) return name;
  }
  for (const rel of ['package.json', 'frontend/client/package.json', 'backend/server/package.json', 'frontend/landing/package.json', 'social/media/package.json']) {
    const pkg = JSON.parse(read(rel));
    const prefix = rel === 'package.json' ? 'npm run' : `npm --prefix ${rel.replace(/\/package\.json$/, '')} run`;
    for (const [script, cmd] of Object.entries(pkg.scripts || {})) {
      if (String(cmd).includes(base)) return `${prefix} ${script}`;
    }
  }
  return 'no runner';
}

function collisions(rels) {
  const by = new Map();
  for (const rel of rels) {
    const base = rel.split('/').pop();
    const list = by.get(base) || [];
    list.push(rel);
    by.set(base, list);
  }
  return [...by.entries()].filter(([, list]) => list.length > 1);
}

function inventory() {
  const rels = [];
  walk(ROOT, '', rels);
  const files = [];
  for (const rel of rels) {
    if (!interesting(rel)) continue;
    const text = read(rel);
    const counts = countCalls(rel, text);
    if (rel.endsWith('.rs') && counts.cases === 0) continue;
    const layer = layerOf(rel);
    files.push({ rel, layer, ...counts });
  }
  const layers = LAYERS.map(([id, band, title, command]) => {
    const rows = files.filter((f) => f.layer === id);
    return {
      id, band, title, command,
      files: rows.length,
      cases: rows.reduce((n, f) => n + f.cases, 0),
      each: rows.reduce((n, f) => n + f.each, 0),
      checks: rows.reduce((n, f) => n + f.checks, 0),
    };
  });
  const unclassified = files.filter((f) => !f.layer).map((f) => f.rel);
  const specText = read('backend/server/test/architecture/test-pyramid.spec.ts');
  const pure = pureModulePaths(specText);
  const gaps = pyramidGaps(srcFiles(), basenamesUnder('backend/server/test/unit'), basenamesUnder('backend/server/test/integration'), pure || []);
  const memory = read('backend/server/test/http/flows.spec.ts');
  const postgres = read('backend/server/test/integration/flows.integration.spec.ts');
  const scenarioFiles = files.filter((f) => f.layer === 'server-scenarios');
  const fns = scenarioFiles.flatMap((f) => scenarioFns(read(f.rel)));
  const scenarioSides = fns.map((name) => ({
    name,
    memory: mentions(memory, name),
    postgres: mentions(postgres, name),
  }));
  const harnesses = files.filter((f) => f.layer === 'browser-e2e').map((f) => ({
    rel: f.rel,
    checks: f.checks,
    runner: runnerFor(f.rel.split('/').pop()),
  }));
  const unitSpecRels = files.filter((f) => f.rel.startsWith('backend/server/test/unit/') && f.rel.endsWith('.spec.ts')).map((f) => f.rel);
  return {
    countedAt: new Date().toISOString(),
    layers,
    files,
    unclassified,
    pureReadable: pure !== null,
    gaps,
    scenarioSides,
    harnesses,
    specCollisions: collisions(unitSpecRels),
    skills: loadSkills(),
    each: files.reduce((n, f) => n + f.each, 0),
  };
}

function scrub(s) {
  return String(s || '')
    .replace(/postgres(?:ql)?:\/\/[^@\s]+@/gi, 'postgresql://***@')
    .replace(/\bphc_[A-Za-z0-9]+\b/g, 'phc_***')
    .replace(/\bphx_[A-Za-z0-9]+\b/g, 'phx_***');
}

function cell(s) {
  return String(s).replace(/\|/g, '/').replace(/\n/g, ' ');
}

function fmtMs(ms) {
  if (ms == null) return '—';
  if (ms < 1000) return `${ms} ms`;
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(1)} s`;
  const m = Math.floor(s / 60);
  return `${m}m ${Math.round(s - m * 60)}s`;
}

function fmtAt(iso) {
  return `${iso.slice(0, 16).replace('T', ' ')} UTC`;
}

function times(n) {
  if (n === 1) return 'once';
  if (n === 2) return 'twice';
  return `${n} times`;
}

function fmtN(n) {
  return n == null ? '—' : String(n);
}

function latestByStage(runs) {
  const map = new Map();
  for (const run of runs) {
    const prev = map.get(run.stage);
    if (!prev || prev.at < run.at) map.set(run.stage, run);
  }
  return map;
}

function mermaidNum(n) {
  const s = (Math.round(n * 10) / 10).toFixed(1);
  return s.endsWith('.0') ? s.slice(0, -2) : s;
}

function yMax(values) {
  const top = Math.max(...values, 0);
  if (top <= 0) return 1;
  const padded = top * 1.15;
  const step = padded > 60 ? 10 : padded > 10 ? 5 : padded > 2 ? 1 : 0.5;
  return Math.ceil(padded / step) * step;
}

function bandChart(inv) {
  const order = [];
  const sums = new Map();
  for (const layer of inv.layers) {
    if (!sums.has(layer.band)) order.push(layer.band);
    sums.set(layer.band, (sums.get(layer.band) || 0) + layer.cases + layer.checks);
  }
  const slices = order.filter((band) => sums.get(band) > 0);
  if (slices.length < 2) return [];
  return [
    'Static calls by band. A slice is `it` / `test` / `#[test]` plus `check()`. The table below is the same count.',
    '',
    '```mermaid',
    'pie title Static calls by band',
    ...slices.map((band) => `    "${band}" : ${sums.get(band)}`),
    '```',
    '',
  ];
}

function wallChart(fastLatest) {
  const secs = fastLatest.map((run) => run.wallMs / 1000);
  return [
    'Newest wall time for each fast stage, in seconds. Each bar is that stage\'s own clock.',
    '',
    '```mermaid',
    'xychart-beta',
    '    title "Fast stage wall time"',
    `    x-axis [${fastLatest.map((run) => run.stage).join(', ')}]`,
    `    y-axis "seconds" 0 --> ${mermaidNum(yMax(secs))}`,
    `    bar [${secs.map(mermaidNum).join(', ')}]`,
    '```',
    '',
  ];
}

function historyChart(runs, stage) {
  const rows = runs
    .filter((run) => run.stage === stage && Number.isFinite(run.wallMs))
    .sort((a, b) => (a.at < b.at ? -1 : 1))
    .slice(-8);
  if (rows.length < 2) return [];
  const secs = rows.map((run) => run.wallMs / 1000);
  const labels = rows.map((run) => run.at.slice(5, 16).replace('T', '-').replace(':', ''));
  return [
    `\`${stage}\` wall time across the kept runs, oldest first.`,
    '',
    '```mermaid',
    'xychart-beta',
    `    title "${stage}"`,
    `    x-axis [${labels.join(', ')}]`,
    `    y-axis "seconds" 0 --> ${mermaidNum(yMax(secs))}`,
    `    line [${secs.map(mermaidNum).join(', ')}]`,
    '```',
    '',
  ];
}

function chartSection(inv, runs) {
  const latest = latestByStage(runs);
  const fastLatest = FAST.map((id) => latest.get(id)).filter((run) => run && Number.isFinite(run.wallMs));
  const blocks = [
    ...bandChart(inv),
    ...(fastLatest.length >= 2 ? wallChart(fastLatest) : []),
    ...historyChart(runs, 'server-integration'),
  ];
  if (!blocks.length) return [];
  return ['### Charts', '', ...blocks];
}

function render(inv, runs) {
  const lines = [];
  const caseTotal = inv.layers.reduce((n, l) => n + l.cases, 0);
  const checkTotal = inv.layers.reduce((n, l) => n + l.checks, 0);
  const fileTotal = inv.layers.reduce((n, l) => n + l.files, 0);
  lines.push(`Counted ${fmtAt(inv.countedAt)} by \`test-census\`. Static cases are \`it\` / \`test\` / \`#[test]\` call sites. A recorded run is what that command executed.`);
  lines.push('');
  lines.push(...chartSection(inv, runs));
  lines.push('### Pyramid');
  lines.push('');
  lines.push('| Band | Layer | Files | Cases | `check()` | Runs in |');
  lines.push('| --- | --- | ---: | ---: | ---: | --- |');
  for (const layer of inv.layers.filter((l) => l.files > 0)) {
    lines.push(`| ${layer.band} | ${cell(layer.title)} | ${layer.files} | ${layer.cases} | ${layer.checks} | \`${cell(layer.command)}\` |`);
  }
  lines.push(`| | **Total** | **${fileTotal}** | **${caseTotal}** | **${checkTotal}** | |`);
  lines.push('');
  lines.push('HTTP scenario cases are written once under `server/test/scenarios` and executed twice: in-memory (`npm run server:test`) and PostgreSQL (`npm run server:integration`). The PostgreSQL runner row counts the runner file. Its cases are the scenario row. `it.each` is one static call and one executed test per row.');
  lines.push('');
  lines.push('### Browser harnesses');
  lines.push('');
  lines.push('| Script | `check()` | Runner |');
  lines.push('| --- | ---: | --- |');
  for (const h of inv.harnesses) lines.push(`| \`${h.rel}\` | ${h.checks} | \`${h.runner}\` |`);
  lines.push('');
  lines.push('### Test skills');
  lines.push('');
  lines.push('Purpose of every skill, including these, is the [Skills](#skills) table. This list is which of them run tests, and whether this log has timed that run.');
  lines.push('');
  lines.push('| Skill | Census stage | Newest recorded run |');
  lines.push('| --- | --- | --- |');
  const latest = latestByStage(runs);
  for (const skill of inv.skills.filter((s) => s.kind === 'test')) {
    const run = skill.stage ? latest.get(skill.stage) : null;
    const when = run ? `${run.status} · ${fmtAt(run.at)} · ${fmtMs(run.wallMs)}` : 'no run recorded';
    lines.push(`| \`${skill.name}\` | ${skill.stage ? `\`${skill.stage}\`` : '—'} | ${when} |`);
  }
  const rest = inv.skills.filter((s) => s.kind !== 'test');
  const byKind = (k) => rest.filter((s) => s.kind === k).map((s) => `\`${s.name}\``).join(', ');
  lines.push('');
  lines.push(`Census skill: ${byKind('census')}. Production read-only skills: ${byKind('prod-read')}. Other skills: ${byKind('other')}.`);
  lines.push('');
  lines.push('### Gaps');
  lines.push('');
  const gapLines = [];
  if (!inv.pureReadable) gapLines.push('- Could not read the pure-module list from `server/test/architecture/test-pyramid.spec.ts`.');
  if (inv.gaps.missingUnit.length) gapLines.push(`- Nest classes with no unit spec: ${inv.gaps.missingUnit.map((p) => `\`${p}\``).join(', ')}.`);
  if (inv.gaps.missingIntegration.length) gapLines.push(`- PostgreSQL classes with no integration spec: ${inv.gaps.missingIntegration.map((p) => `\`${p}\``).join(', ')}.`);
  if (inv.gaps.missingPure.length) gapLines.push(`- Pure modules named by the pyramid audit with no unit spec: ${inv.gaps.missingPure.map((p) => `\`${p}\``).join(', ')}.`);
  for (const side of inv.scenarioSides) {
    if (side.memory === 0 || side.postgres === 0) gapLines.push(`- \`${side.name}\` is registered on ${side.memory ? 'in-memory' : 'PostgreSQL'} and missing from the other backend.`);
  }
  for (const [base, list] of inv.specCollisions) gapLines.push(`- Unit spec basename \`${base}\` is shared by ${list.map((p) => `\`${p}\``).join(', ')}. The pyramid audit matches basenames, so one file satisfies both.`);
  for (const rel of inv.unclassified) gapLines.push(`- Unclassified test file \`${rel}\`.`);
  for (const h of inv.harnesses.filter((x) => x.runner === 'no runner')) gapLines.push(`- \`${h.rel}\` has no skill script and no package.json script.`);
  for (const skill of inv.skills.filter((s) => s.kind === 'test' && !s.stage)) gapLines.push(`- Test skill \`${skill.name}\` has no census stage.`);
  const untimed = [...FAST, 'e2e', 'live-board', 'replay', 'verified', 'localnet', 'posthog', 'program-check'].filter((id) => !latest.has(id));
  if (untimed.length) gapLines.push(`- No recorded run: ${untimed.map((id) => `\`${id}\``).join(', ')}.`);
  if (!gapLines.length) gapLines.push('- The pyramid list is empty, every scenario function is on both backends, and every stage above has a recorded run.');
  lines.push(...gapLines);
  lines.push('');
  lines.push(...coverageSection(inv));
  const doubled = inv.scenarioSides.filter((s) => s.memory > 1 || s.postgres > 1);
  const silent = inv.harnesses.filter((h) => h.checks === 0).map((h) => `\`${h.rel.split('/').pop()}\``);
  if (doubled.length || inv.each || silent.length) {
    lines.push('### Notes');
    lines.push('');
    if (inv.each) lines.push(`- ${inv.each} \`it.each\` / \`test.each\` call sites. The case column counts the call. The run counts each row.`);
    for (const side of doubled) lines.push(`- \`${side.name}\` is registered ${times(side.memory)} on the in-memory runner and ${times(side.postgres)} on PostgreSQL, so those cases execute that many times per backend.`);
    if (silent.length) lines.push(`- ${silent.join(', ')} report failures through the shared \`problems\` list, so they have no \`check()\` calls.`);
    lines.push('- Wall time is each stage\'s own clock, including process startup, and is longer when other stages are using the machine. `server-unit` finishes before `server-integration` starts. `server-integration` includes `npm run db:up`.');
    lines.push('');
  }
  lines.push('### Recorded runs');
  lines.push('');
  if (!runs.length) {
    lines.push('No run recorded yet. `npm run test:census -- run` times the fast stages and appends them here.');
  } else {
    const shown = [...runs].sort((a, b) => (a.at < b.at ? 1 : -1)).slice(0, SHOW);
    lines.push(`Newest first. ${runs.length} ${runs.length === 1 ? 'run' : 'runs'} kept in \`.claude/skills/test-census/runs.json\` (up to ${KEEP} per stage).`);
    lines.push('');
    lines.push('| When | Stage | Result | Passed | Failed | Skipped | Wall |');
    lines.push('| --- | --- | --- | ---: | ---: | ---: | ---: |');
    for (const run of shown) {
      lines.push(`| ${fmtAt(run.at)} | \`${run.stage}\` | ${run.status} | ${fmtN(run.passed)} | ${fmtN(run.failed)} | ${fmtN(run.skipped)} | ${fmtMs(run.wallMs)} |`);
    }
    if (runs.length > SHOW) lines.push('', `Showing ${SHOW} of ${runs.length}.`);
    const fastLatest = FAST.map((id) => latest.get(id)).filter(Boolean);
    if (fastLatest.length) {
      lines.push('');
      lines.push(fastTimingSentence(fastLatest));
      const compare = (stage, ids) => {
        const run = latest.get(stage);
        if (!run || run.passed == null) return null;
        const calls = inv.layers.filter((l) => ids.includes(l.id)).reduce((n, l) => n + l.cases + l.checks, 0);
        return calls === run.passed ? null : { stage, passed: run.passed, calls };
      };
      const diffs = [
        compare('server-unit', ['server-domain', 'server-handlers', 'server-services', 'server-controllers', 'server-infrastructure', 'server-other-unit', 'server-audits', 'server-scenarios', 'server-http']),
        compare('server-integration', ['server-repositories', 'server-concurrency', 'server-migration-drift', 'server-integration-other', 'server-scenarios']),
        compare('client-headless', ['client-headless']),
      ].filter(Boolean);
      if (diffs.length) {
        lines.push('A run counts more than the static call sites when `it`, `test`, or `check()` sits in a loop or in `it.each`, and when a scenario function is registered more than once.');
        for (const d of diffs) lines.push(`\`${d.stage}\` executed ${d.passed}. Static call sites for that stage: ${d.calls}.`);
      }
    }
    const failed = shown.filter((r) => r.status !== 'pass');
    if (failed.length) {
      lines.push('');
      lines.push('Failures in the rows above:');
      lines.push('');
      for (const run of failed) {
        const names = (run.failures || []).slice(0, 8).map((n) => `\`${cell(n)}\``).join(', ');
        const note = run.note ? ` ${cell(scrub(run.note))}` : '';
        lines.push(`- \`${run.stage}\` ${fmtAt(run.at)}: ${run.status}.${names ? ` ${names}.` : ''}${note}`);
      }
    }
  }
  lines.push('');
  lines.push('Refresh the numbers with `npm run test:census -- run`, then `npm run test:census -- readme`. Chrome, localnet, PostHog, and `program-check` are opt-in stage names and are not part of a plain `run`.');
  return lines.join('\n');
}

function reportOf(inv) {
  return featureReport({ ROOT, files: inv.files, harnesses: inv.harnesses });
}

function coverageSection(inv) {
  const rep = reportOf(inv);
  return [
    '### Coverage by feature',
    '',
    `Which tests reach each product feature. The map (source paths, routes, harnesses per feature, steps per flow) is \`.claude/skills/test-census/features.mjs\`. Routes, files and cases are counted, not judged. Every route, file and flow step: [\`${REPORT_REL}\`](${REPORT_REL}).`,
    '',
    sourceLine(rep),
    '',
    ...GRADE_RULE,
    '',
    ...featureTable(rep),
    '',
    '### Coverage by user flow',
    '',
    'A flow is the API steps one user journey takes. A step counts when a scenario case requests it, and (once browser runs are recorded) when the server logged it during a browser suite.',
    '',
    ...flowTable(rep),
    '',
    '### Coverage by controller',
    '',
    'The controller spec only checks dispatch to the bus. Behaviour is the handler spec and the scenarios.',
    '',
    ...controllerTable(rep),
    '',
  ];
}

function spliceReadme(text, block) {
  const start = text.indexOf(START);
  const end = text.indexOf(END);
  if (start < 0 || end < start) throw new Error(`README is missing ${START} … ${END}`);
  return `${text.slice(0, start + START.length)}\n\n${block.trim()}\n\n${text.slice(end)}`;
}

function loadRuns() {
  if (!existsSync(RUNS)) return { version: 1, runs: [] };
  const json = JSON.parse(readFileSync(RUNS, 'utf8'));
  if (!json || !Array.isArray(json.runs)) throw new Error(`${RUNS} is not a run log`);
  return json;
}

function saveRuns(store) {
  const by = new Map();
  for (const run of store.runs) {
    const list = by.get(run.stage) || [];
    list.push(run);
    by.set(run.stage, list);
  }
  const next = [];
  for (const list of by.values()) {
    list.sort((a, b) => (a.at < b.at ? -1 : 1));
    next.push(...list.slice(-KEEP));
  }
  next.sort((a, b) => (a.at < b.at ? -1 : 1));
  writeFileSync(RUNS, `${JSON.stringify({ version: 1, runs: next }, null, 2)}\n`);
  return next;
}

function flatTests(relDir, suffix) {
  const names = readdirSync(join(ROOT, relDir), { withFileTypes: true });
  if (names.some((d) => d.isDirectory())) throw new Error(`${relDir} has a subdirectory; the census run list expects a flat directory`);
  return names.filter((d) => d.name.endsWith(suffix)).map((d) => `test/${d.name}`);
}

// The integration suite refuses a database whose name does not end in _test. Fail here before Docker starts, and never echo the URL.
function unsafeTestDatabase(url) {
  if (!url) return '';
  let name = '';
  try { name = new URL(url).pathname.replace(/^\//, '').split('/')[0]; } catch { return 'TEST_DATABASE_URL is not a database URL'; }
  if (!name.endsWith('_test')) return 'TEST_DATABASE_URL must name a database ending in _test';
  return '';
}

function cargoOnPath() {
  const home = process.env.HOME || '';
  const path = `${home}/.cargo/bin:${process.env.PATH || ''}`;
  const probe = spawnSync('cargo', ['--version'], { stdio: 'ignore', env: { ...process.env, PATH: path } });
  return probe.status === 0 ? path : null;
}

function stagePlan(id) {
  const node = process.execPath;
  const vitest = join(ROOT, 'backend/server/node_modules/.bin/vitest');
  const jsonOut = (name) => join(tmpdir(), `fc-census-${name}-${process.pid}.json`);
  const tap = (cwd, files) => ({ cwd, cmd: node, args: ['--test', '--test-reporter=tap', ...files], parse: 'tap', timeout: 15 * 60 * 1000 });
  if (id === 'client-unit') return tap(join(ROOT, 'frontend/client'), flatTests('frontend/client/test', '.test.mjs'));
  if (id === 'landing') return tap(join(ROOT, 'frontend/landing'), flatTests('frontend/landing/test', '.test.js'));
  if (id === 'media') return tap(join(ROOT, 'social/media'), flatTests('social/media/test', '.test.mjs'));
  if (id === 'client-headless') return { cwd: join(ROOT, 'frontend/client'), cmd: 'sh', args: ['tools/trace.sh', 'run'], parse: 'checks', timeout: 15 * 60 * 1000 };
  if (id === 'server-unit') {
    return { cwd: join(ROOT, 'backend/server'), cmd: vitest, args: ['run', '--reporter=json', '--outputFile', jsonOut('server-unit')], parse: 'vitest', timeout: 15 * 60 * 1000, json: jsonOut('server-unit') };
  }
  if (id === 'server-integration') {
    return { cwd: join(ROOT, 'backend/server'), cmd: vitest, args: ['run', '--config', 'vitest.integration.config.ts', '--reporter=json', '--outputFile', jsonOut('server-integration')], parse: 'vitest', timeout: 20 * 60 * 1000, json: jsonOut('server-integration'), dbUp: true };
  }
  if (id === 'program-test') return { cwd: join(ROOT, 'backend/programs'), cmd: 'cargo', args: ['test'], parse: 'cargo', timeout: 20 * 60 * 1000, cargo: true };
  if (id === 'e2e') return withRouteLog(bash(join(ROOT, '.claude/skills/run-tests/e2e.sh'), [], 50));
  if (id.startsWith('e2e:')) {
    const suite = id.slice(4);
    if (!E2E_SUITES.includes(suite)) throw new Error(`unknown e2e suite ${suite}`);
    return withRouteLog(bash(join(ROOT, '.claude/skills/run-tests/e2e.sh'), [suite], 40));
  }
  if (id === 'live-board') return withRouteLog(bash(join(ROOT, '.claude/skills/live-board-test/run.sh'), [], 30));
  if (id === 'replay') return withRouteLog(bash(join(ROOT, '.claude/skills/replay-test/run.sh'), [], 30));
  if (id === 'verified') return withRouteLog(bash(join(ROOT, '.claude/skills/verified-play-test/run.sh'), [], 40));
  if (id === 'localnet') return { cwd: ROOT, cmd: 'npm', args: ['run', 'test:localnet'], parse: 'checks', timeout: 25 * 60 * 1000 };
  if (id === 'posthog') return bash(join(ROOT, '.claude/skills/posthog-test/smoke.sh'), [], 15);
  if (id === 'program-check') return bash(join(ROOT, '.claude/skills/program-check/check.sh'), [], 60);
  throw new Error(`unknown stage ${id}. Fast: ${FAST.join(', ')}. Opt-in: ${OPT_IN.join(', ')}`);
}

function bash(script, args, minutes) {
  return { cwd: ROOT, cmd: 'bash', args: [script, ...args], parse: 'checks', timeout: minutes * 60 * 1000 };
}

// Every stage that goes through run-tests/e2e.sh: the script copies the server's request lines into E2E_LOG_DIR/<suite>.log,
// and the census turns them into the routes each suite really hit (e2e-routes.json).
function withRouteLog(plan) {
  const dir = mkdtempSync(join(tmpdir(), 'fc-census-routes-'));
  return { ...plan, env: { E2E_LOG_DIR: dir }, routeLog: dir };
}

function commandLine(plan) {
  const rel = (p) => (typeof p === 'string' && p.startsWith(ROOT) ? p.slice(ROOT.length + 1) : p);
  return [plan.cmd === process.execPath ? 'node' : rel(plan.cmd), ...plan.args.map(rel)].join(' ');
}

// A detached child is its own process group. ESRCH means it is already gone; anything else is a real failure.
function killGroup(pid, signal) {
  if (!pid) return;
  try { process.kill(-pid, signal); }
  catch (err) {
    if (err?.code === 'ESRCH') return;
    try { process.kill(pid, signal); }
    catch (err2) { if (err2?.code !== 'ESRCH') throw err2; }
  }
}

function runProcess(plan) {
  return new Promise((resolveRun) => {
    const env = { ...process.env, CARGO_TERM_COLOR: 'never', NO_COLOR: '1', ...(plan.env || {}) };
    if (plan.cargo) {
      const path = cargoOnPath();
      if (!path) {
        resolveRun({ code: null, wallMs: 0, passed: null, failed: null, skipped: null, failures: [], note: 'cargo not on PATH', status: 'skipped' });
        return;
      }
      env.PATH = path;
    }
    const t0 = Date.now();
    let passed = 0;
    let failed = 0;
    const failLines = []; // `FAIL <check>` lines of the harnesses, named by the e2e.sh suite they ran in
    let suite = '';
    let checks = 0;
    let rest = '';
    let tail = '';
    const tally = (line) => {
      if (/^ok {2,}/.test(line)) { passed += 1; checks += 1; }
      else if (/^FAIL /.test(line)) { failed += 1; checks += 1; failLines.push(`${suite ? `${suite}: ` : ''}${line.slice(5, 200)}`); }
      else if (/^▸ e2e /.test(line)) suite = line.slice(6).trim();
    };
    const feed = (chunk) => {
      tail = (tail + chunk).slice(-200_000);
      const parts = (rest + chunk).split('\n');
      rest = parts.pop() || '';
      for (const line of parts) tally(line);
    };
    const child = spawn(plan.cmd, plan.args, { cwd: plan.cwd, env, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
    child.stdout.on('data', (b) => feed(b.toString('utf8')));
    child.stderr.on('data', (b) => feed(b.toString('utf8')));
    let timedOut = false;
    let settled = false;
    let stopping = false;
    let killTimer;
    const stopSignals = () => {
      process.off('SIGINT', onStop);
      process.off('SIGTERM', onStop);
      process.off('SIGHUP', onStop);
    };
    const done = (row) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      clearTimeout(killTimer);
      // A signal owns the exit. Resolving here would start the next stage during the grace period.
      if (stopping) return;
      stopSignals();
      resolveRun(row);
    };
    // Ctrl-C must kill the group. A listener replaces Node's default exit, so the second signal exits now.
    const onStop = (signal) => {
      const exitCode = signal === 'SIGINT' ? 130 : 143;
      if (stopping) {
        killGroup(child.pid, 'SIGKILL');
        process.exit(exitCode);
      }
      stopping = true;
      killGroup(child.pid, 'SIGTERM');
      setTimeout(() => {
        killGroup(child.pid, 'SIGKILL');
        process.exit(exitCode);
      }, KILL_GRACE_MS);
    };
    process.on('SIGINT', onStop);
    process.on('SIGTERM', onStop);
    process.on('SIGHUP', onStop);
    const timer = setTimeout(() => {
      if (settled) return;
      timedOut = true;
      killGroup(child.pid, 'SIGTERM');
      killTimer = setTimeout(() => {
        if (!settled) killGroup(child.pid, 'SIGKILL');
      }, KILL_GRACE_MS);
    }, plan.timeout);
    child.on('close', (code) => {
      if (rest) tally(rest);
      done({ code: timedOut ? null : code, wallMs: Date.now() - t0, passed, failed, checks, failLines: failLines.map(scrub), tail: scrub(tail), timedOut });
    });
    child.on('error', (err) => {
      done({ code: 127, wallMs: Date.now() - t0, passed: 0, failed: 0, checks: 0, tail: scrub(err.message), timedOut: false });
    });
  });
}

function parseTap(tail) {
  const grab = (name) => {
    const found = [...tail.matchAll(new RegExp(`^# ${name} (\\d+(?:\\.\\d+)?)`, 'gm'))];
    if (!found.length) return null;
    return Number(found[found.length - 1][1]);
  };
  return { passed: grab('pass'), failed: grab('fail'), skipped: grab('skipped') };
}

function parseCargo(tail) {
  const rows = [...tail.matchAll(/test result: \w+\. (\d+) passed; (\d+) failed; (\d+) ignored/g)];
  if (!rows.length) return { passed: null, failed: null, skipped: null, failures: [] };
  let passed = 0;
  let failed = 0;
  let skipped = 0;
  for (const row of rows) {
    passed += Number(row[1]);
    failed += Number(row[2]);
    skipped += Number(row[3]);
  }
  const failures = [...tail.matchAll(/^test (\S+) \.\.\. FAILED/gm)].map((m) => m[1]).slice(0, 8);
  return { passed, failed, skipped, failures };
}

function parseVitest(file, startedAt) {
  if (!existsSync(file)) throw new Error('vitest report missing');
  if (startedAt != null && statSync(file).mtimeMs + 1000 < startedAt) throw new Error('vitest report is older than this stage');
  const json = JSON.parse(readFileSync(file, 'utf8'));
  const failures = [];
  for (const fileResult of json.testResults || []) {
    for (const assertion of fileResult.assertionResults || []) {
      if (assertion.status === 'failed' && failures.length < 8) failures.push(assertion.fullName || assertion.title || fileResult.name);
    }
  }
  return {
    passed: json.numPassedTests ?? null,
    failed: json.numFailedTests ?? null,
    skipped: (json.numPendingTests || 0) + (json.numTodoTests || 0),
    failures,
  };
}

async function runStage(id) {
  const plan = stagePlan(id);
  const at = new Date().toISOString();
  process.stderr.write(`▸ ${id}\n`);
  let wallExtra = 0;
  if (plan.dbUp) {
    const refused = unsafeTestDatabase(process.env.TEST_DATABASE_URL);
    if (refused) {
      return finish(id, at, plan, { wallMs: 0, status: 'fail', passed: null, failed: null, skipped: null, failures: [], note: refused });
    }
    const up = await runProcess({ cwd: ROOT, cmd: 'npm', args: ['run', 'db:up'], parse: 'checks', timeout: 5 * 60 * 1000 });
    wallExtra += up.wallMs;
    if (up.timedOut || up.code !== 0) {
      return finish(id, at, plan, {
        wallMs: wallExtra,
        status: up.timedOut ? 'timeout' : 'fail',
        passed: null,
        failed: null,
        skipped: null,
        failures: [],
        note: up.timedOut ? 'db:up exceeded 5 min' : lastLine(up.tail),
      });
    }
  }
  if (plan.json) {
    try { unlinkSync(plan.json); } catch (err) { if (err.code !== 'ENOENT') throw err; }
  }
  const startedAt = Date.now();
  const result = await runProcess(plan);
  result.wallMs += wallExtra;
  if (plan.routeLog) {
    const suites = recordE2eRoutes(ROOT, plan.routeLog, at);
    if (suites?.length) process.stderr.write(`  routes recorded for ${suites.join(', ')}\n`);
    rmSync(plan.routeLog, { recursive: true, force: true });
  }
  if (result.status === 'skipped') return finish(id, at, plan, result);
  if (result.timedOut) return finish(id, at, plan, { ...result, status: 'timeout', passed: null, failed: null, skipped: null, failures: [], note: `exceeded ${Math.round(plan.timeout / 60000)} min` });
  let passed = null;
  let failed = null;
  let skipped = null;
  let failures = [];
  let note = '';
  try {
    if (plan.parse === 'tap') ({ passed, failed, skipped } = parseTap(result.tail));
    else if (plan.parse === 'cargo') ({ passed, failed, skipped, failures } = parseCargo(result.tail));
    else if (plan.parse === 'vitest') ({ passed, failed, skipped, failures } = parseVitest(plan.json, startedAt));
    else if (result.checks) { passed = result.passed; failed = result.failed; skipped = 0; failures = result.failLines || []; }
  } catch (err) {
    note = lastLine(err.message);
  }
  if (result.code !== 0 && !failures.length) note = note || lastLine(result.tail);
  const status = result.code === 0 ? 'pass' : 'fail';
  return finish(id, at, plan, { wallMs: result.wallMs, status, passed, failed, skipped, failures, note });
}

function lastLine(text) {
  const line = String(text || '').split('\n').map((l) => l.trim()).filter(Boolean).pop() || '';
  return scrub(line).slice(0, 240);
}

function finish(id, at, plan, result) {
  const row = {
    stage: id,
    at,
    wallMs: result.wallMs,
    status: result.status,
    passed: result.passed,
    failed: result.failed,
    skipped: result.skipped,
    command: commandLine(plan),
    failures: result.failures || [],
    note: scrub(result.note || ''),
  };
  const store = loadRuns();
  store.runs.push(row);
  saveRuns(store);
  process.stderr.write(`  ${row.status} passed=${fmtN(row.passed)} failed=${fmtN(row.failed)} ${fmtMs(row.wallMs)}\n`);
  return row;
}

function knownStage(id) {
  return FAST.includes(id) || OPT_IN.includes(id);
}

// Stages in one lane run one after another. Lanes run together.
// The two server stages share server/'s vitest project. The machine lane shares Chrome ports and the compose database.
function laneOf(id) {
  if (id === 'server-unit' || id === 'server-integration') return 'server';
  if (id === 'e2e' || id.startsWith('e2e:') || id === 'live-board' || id === 'replay' || id === 'verified' || id === 'localnet' || id === 'posthog') return 'machine';
  return id;
}

function schedule(ids) {
  const groups = new Map();
  const order = [];
  for (const id of ids) {
    const lane = laneOf(id);
    if (!groups.has(lane)) {
      groups.set(lane, []);
      order.push(lane);
    }
    groups.get(lane).push(id);
  }
  return order.map((lane) => groups.get(lane));
}

function fastTimingSentence(fastLatest) {
  const slow = fastLatest.reduce((a, b) => (a.wallMs >= b.wallMs ? a : b));
  const sum = fastLatest.reduce((n, r) => n + r.wallMs, 0);
  const start = Math.min(...fastLatest.map((r) => Date.parse(r.at)));
  const end = Math.max(...fastLatest.map((r) => Date.parse(r.at) + r.wallMs));
  const span = end - start;
  const head = `Newest fast stages on record: ${fastLatest.length} of ${FAST.length}`;
  const slowBit = `Slowest of those: \`${slow.stage}\` at ${fmtMs(slow.wallMs)}.`;
  if (Number.isFinite(span) && span + 1000 < sum) {
    return `${head}, overlapped in ${fmtMs(span)}. ${slowBit} Added up, the stage times are ${fmtMs(sum)}.`;
  }
  return `${head}, ${fmtMs(sum)} one after another. ${slowBit}`;
}

async function runLanes(list) {
  const rows = await Promise.all(schedule(list).map(async (lane) => {
    const done = [];
    for (const id of lane) done.push(await runStage(id));
    return done;
  }));
  return rows.flat();
}

async function main(argv) {
  const [raw = 'print', ...rest] = argv;
  const cmd = raw === '--self-test' ? 'self-test' : raw;
  const write = rest.includes('--readme') || cmd === 'readme';
  if (cmd === 'self-test') return selfTest();
  if (cmd === 'run') {
    const stages = rest.filter((a) => !a.startsWith('--'));
    const list = stages.length ? stages : FAST;
    for (const id of list) if (!knownStage(id)) throw new Error(`unknown stage ${id}`);
    const rows = await runLanes(list);
    const bad = rows.filter((row) => row.status !== 'pass').length;
    if (write) writeReadme();
    else process.stdout.write(`${render(inventory(), loadRuns().runs)}\n`);
    process.exitCode = bad ? 1 : 0;
    return;
  }
  if (cmd === 'features') {
    const inv = inventory();
    const rep = reportOf(inv);
    if (rest.includes('--write')) process.stderr.write(`updated ${join(ROOT, writeFull(ROOT, rep, inv.countedAt))}\n`);
    else process.stdout.write(`${renderFull(rep, inv.countedAt)}\n`);
    return;
  }
  if (cmd === 'coverage') {
    process.exitCode = await lineCoverage(!rest.includes('--no-integration'));
    if (rest.includes('--readme')) writeReadme();
    return;
  }
  if (cmd !== 'print' && cmd !== 'readme') throw new Error('use: census.mjs [print|readme|run|features [--write]|coverage [--no-integration] [--readme]|self-test|--self-test]');
  if (write || cmd === 'readme') writeReadme();
  else process.stdout.write(`${render(inventory(), loadRuns().runs)}\n`);
}

function writeReadme() {
  const inv = inventory();
  process.stderr.write(`updated ${join(ROOT, writeFull(ROOT, reportOf(inv), inv.countedAt))}\n`);
  const block = render(inv, loadRuns().runs);
  const next = spliceReadme(readFileSync(README, 'utf8'), block);
  writeFileSync(README, next.endsWith('\n') ? next : `${next}\n`);
  process.stderr.write(`updated ${README}\n`);
}

// v8 line coverage: the server's unit + in-memory HTTP suite (+ the PostgreSQL suite), the node:test suites of client,
// landing and media, and the headless playthrough (its esbuild bundle carries a source map, so lines land on js/…). Writes coverage.json.
async function lineCoverage(withIntegration) {
  const dir = mkdtempSync(join(tmpdir(), 'fc-census-cov-'));
  const server = join(ROOT, 'backend/server');
  const vitest = join(server, 'node_modules/.bin/vitest');
  const vitestCov = (sub, extra) => ({
    cwd: server, cmd: vitest, timeout: 25 * 60 * 1000,
    args: ['run', ...extra, '--reporter=dot', '--coverage.enabled', '--coverage.provider=v8', '--coverage.reporter=json', `--coverage.reportsDirectory=${join(dir, sub)}`, '--coverage.include=src/**/*.ts', '--coverage.exclude=src/**/*.d.ts'],
  });
  const nodeCov = (pkg, files) => ({
    cwd: join(ROOT, pkg), cmd: process.execPath, timeout: 15 * 60 * 1000,
    args: ['--test', '--experimental-test-coverage', '--test-reporter=lcov', `--test-reporter-destination=${join(dir, `${pkg.split('/').pop()}.lcov`)}`, '--test-reporter=dot', '--test-reporter-destination=stdout', ...files],
  });
  // The headless bundle must sit inside client/: node:test leaves files outside the working directory out of the report.
  const bundleDir = join(ROOT, 'frontend/client', `.census-cov-${process.pid}`);
  mkdirSync(bundleDir, { recursive: true });
  writeFileSync(join(bundleDir, 'headless.cov.mjs'), `process.argv[2] = ${JSON.stringify(join(bundleDir, 'fc-test.js'))};\nawait import('../tools/headless-test.mjs');\n`);
  const esbuild = { cwd: join(ROOT, 'frontend/client'), cmd: 'npx', timeout: 5 * 60 * 1000, args: ['esbuild', 'js/main.js', '--bundle', '--format=esm', '--alias:three=./tools/stub-three.mjs', '--sourcemap', `--outfile=${join(bundleDir, 'fc-test.js')}`, '--log-level=error'] };
  const headless = nodeCov('frontend/client', [join(bundleDir, 'headless.cov.mjs')]);
  headless.args = ['--enable-source-maps', ...headless.args.map((a) => a.replace('client.lcov', 'headless.lcov'))];
  const jobs = [
    ['server unit + HTTP', vitestCov('unit', [])],
    ['client headless bundle', esbuild],
    ['client headless playthrough', headless],
    ['client unit', nodeCov('frontend/client', flatTests('frontend/client/test', '.test.mjs'))],
    ['landing', nodeCov('frontend/landing', flatTests('frontend/landing/test', '.test.js'))],
    ['media', nodeCov('social/media', flatTests('social/media/test', '.test.mjs'))],
  ];
  if (withIntegration) {
    const refused = unsafeTestDatabase(process.env.TEST_DATABASE_URL);
    if (refused) throw new Error(refused);
    const up = await runProcess({ cwd: ROOT, cmd: 'npm', args: ['run', 'db:up'], timeout: 5 * 60 * 1000 });
    if (up.code !== 0) throw new Error(`db:up failed: ${lastLine(up.tail)}`);
    jobs.splice(1, 0, ['server PostgreSQL', vitestCov('integration', ['--config', 'vitest.integration.config.ts'])]);
  }
  let bad = 0;
  try {
  for (const [name, plan] of jobs) {
    process.stderr.write(`▸ coverage: ${name}\n`);
    const r = await runProcess(plan);
    process.stderr.write(`  ${r.code === 0 ? 'pass' : `exit ${r.code}${r.timedOut ? ' (timeout)' : ''}`} ${fmtMs(r.wallMs)}\n`);
    if (r.code !== 0) { bad += 1; process.stderr.write(`  ${lastLine(r.tail)}\n`); }
  }
  } finally {
    rmSync(bundleDir, { recursive: true, force: true });
  }
  const readJson = (sub) => { try { return JSON.parse(readFileSync(join(dir, sub, 'coverage-final.json'), 'utf8')); } catch { return {}; } };
  const files = linesFromIstanbul(mergeIstanbul(readJson('unit'), readJson('integration')), ROOT);
  const acc = {};
  for (const [name, pkg] of [['client', 'frontend/client'], ['headless', 'frontend/client'], ['landing', 'frontend/landing'], ['media', 'social/media']]) {
    const lcov = join(dir, `${name}.lcov`);
    if (existsSync(lcov)) addLcov(acc, readFileSync(lcov, 'utf8'), ROOT, join(ROOT, pkg));
  }
  Object.assign(files, linesFromLcov(acc));
  rmSync(dir, { recursive: true, force: true });
  const scope = `server unit + HTTP${withIntegration ? ' + PostgreSQL' : ''}, the headless playthrough, client / landing / media node:test`;
  saveLines(files, scope);
  process.stderr.write(`coverage: ${Object.keys(files).length} files → ${join(HERE, 'coverage.json')}${bad ? ` (${bad} job(s) failed – numbers are partial)` : ''}\n`);
  return bad ? 1 : 0;
}

function assert(ok, message) {
  if (!ok) throw new Error(message);
}

const SPEC_ID = /\b([A-Z][A-Z0-9]*-T-\d+(?:\.\.\d+|…\d+)?|AC-[A-Z]\d+(?:…[A-Z]\d+)?)\b/g;
const PLANNED_CATALOG = /An id is not a written test|planned ids|each has a planned id|catalog of tests to write|Those ids are not written tests/;
const VALIDATOR_SCRIPTS = [
  '.claude/skills/localnet-e2e/run.sh',
  'backend/server/scripts/e2e-honk-chain.mjs',
  'backend/server/scripts/e2e-localnet-chaos.mjs',
  'backend/server/scripts/e2e-localnet-day.mjs',
  'backend/server/scripts/e2e-localnet-payout.mjs',
  'backend/server/scripts/e2e-localnet.mjs',
  'backend/server/scripts/honk-chain.mjs',
  'backend/server/scripts/localnet-coverage.mjs',
  'backend/server/scripts/localnet-fault-proxy.mjs',
  'backend/server/scripts/localnet-fixtures.mjs',
  'backend/server/scripts/localnet-legacy-pledges.mjs',
  'backend/server/scripts/localnet-seal.mjs',
  'backend/server/scripts/pool-admin.mjs',
];

function expandSpecId(token) {
  const range = token.match(/^([A-Z][A-Z0-9]*-T-)(\d+)(?:\.\.|…)(\d+)$/);
  if (range) {
    const ids = [];
    for (let n = +range[2]; n <= +range[3]; n += 1) ids.push(range[1] + String(n).padStart(range[2].length, '0'));
    return ids;
  }
  const ac = token.match(/^(AC-[A-Z])(\d+)…[A-Z](\d+)$/);
  if (ac) {
    const ids = [];
    for (let n = +ac[2]; n <= +ac[3]; n += 1) ids.push(ac[1] + n);
    return ids;
  }
  return [token];
}

// A bullet's subject is the label before the colon. A table's subjects are its first and last cells.
// An id named later in the sentence is a cross-reference, not a second requirement.
function subjectIds(line) {
  let region = '';
  if (/^\s*\|/.test(line)) {
    const cells = line.split('|').slice(1, -1);
    region = `${cells[0] || ''} ${cells[cells.length - 1] || ''}`;
  } else if (/^\s*(?:[-*]|#{1,6}\s)/.test(line)) region = line.split(':')[0];
  return [...region.matchAll(SPEC_ID)].flatMap((m) => expandSpecId(m[1]));
}

function specIdSets() {
  const required = new Set();
  const withdrawn = new Set();
  for (const name of readdirSync(join(ROOT, 'docs/spec'))) {
    if (!name.endsWith('.md') || name === 'DECISIONS.md') continue;
    const text = read(`docs/spec/${name}`);
    const catalog = PLANNED_CATALOG.test(text) || name === 'PROCESS.md' || name === 'README.md';
    for (const line of text.split('\n')) {
      const ids = /WITHDRAWN/.test(line) ? [...line.matchAll(SPEC_ID)].flatMap((m) => expandSpecId(m[1])) : subjectIds(line);
      if (!ids.length) continue;
      if (/WITHDRAWN/.test(line)) { for (const id of ids) withdrawn.add(id); continue; }
      if (catalog) continue;
      for (const id of ids) required.add(id);
    }
  }
  for (const id of withdrawn) required.delete(id);
  return { required, withdrawn };
}

function withoutSkipped(code) {
  const skipAt = /\b(?:it|test|describe)\.(?:skip|todo)\b|\bxit\b|\bxtest\b/g;
  let out = '';
  let i = 0;
  while (i < code.length) {
    skipAt.lastIndex = i;
    const m = skipAt.exec(code);
    if (!m) return out + code.slice(i);
    out += code.slice(i, m.index);
    let j = m.index + m[0].length;
    while (j < code.length && /\s/.test(code[j])) j += 1;
    if (code[j] !== '(') { i = j; continue; }
    let depth = 0;
    let q = '';
    while (j < code.length) {
      const c = code[j];
      j += 1;
      if (q) {
        if (c === '\\') { j += 1; continue; }
        if (c === q) q = '';
        continue;
      }
      if (c === "'" || c === '"' || c === '`') { q = c; continue; }
      if (c === '(') depth += 1;
      else if (c === ')') { depth -= 1; if (depth === 0) break; }
    }
    i = j;
  }
  return out;
}

function idMapped(live, id) {
  if (live.includes(id)) return true;
  const m = id.match(/^([A-Z][A-Z0-9]*-T-)(\d+)$/);
  if (!m) return false;
  const n = +m[2];
  const re = new RegExp(`${m[1]}(\\d+)(?:\\.\\.|…)(\\d+)`, 'g');
  for (const hit of live.matchAll(re)) {
    if (hit[1].length === m[2].length && n >= +hit[1] && n <= +hit[2]) return true;
  }
  return false;
}

function liveTestSource() {
  const rels = [];
  walk(ROOT, '', rels);
  return rels.filter((rel) => /\.(?:spec|test)\.(?:ts|js|mjs)$/.test(rel) || /(?:^|\/)e2e-.*\.mjs$/.test(rel))
    .map((rel) => withoutSkipped(codeOf(read(rel)))).join('\n');
}

function chromeSuiteSource() {
  const e2e = read('.claude/skills/run-tests/e2e.sh');
  const scripts = [...new Set([...e2e.matchAll(/node ((?:scripts|frontend\/landing\/tools)\/[\w.-]+\.mjs)/g)].map((m) => m[1]))];
  assert(scripts.length >= 20, `e2e.sh launched ${scripts.length} scripts`);
  const seen = new Set(), sources = [];
  for (const rel of scripts) {
    const full = rel.startsWith('scripts/') ? `backend/server/${rel}` : rel;
    if (seen.has(full)) continue;
    seen.add(full);
    assert(existsSync(join(ROOT, full)), `e2e.sh names a missing script ${full}`);
    const source = codeOf(read(full));
    sources.push(source);
    // Local-validator bootstraps launch their Chrome child after the scratch chain/API are ready.
    scripts.push(...spawnedNodeScripts(source));
  }
  return sources.join('\n');
}

function spawnedNodeScripts(source) {
  return [...source.matchAll(/spawn\(\s*process\.execPath\s*,\s*\[\s*['"](scripts\/[\w.-]+\.mjs)['"]/g)].map(m => m[1]);
}

function htmlPageReport(suite) {
  const pages = [];
  for (const dir of ['frontend/client', 'frontend/landing']) {
    for (const name of readdirSync(join(ROOT, dir))) {
      if (!name.endsWith('.html')) continue;
      const st = statSync(join(ROOT, dir, name));
      if (st.isFile()) pages.push(`${dir}/${name}`);
    }
  }
  const excluded = [];
  const missed = [];
  for (const rel of pages) {
    if (rel === 'frontend/client/index.html') {
      excluded.push(`${rel}: the no-build placeholder; e2e.sh builds the landing and the landing suite opens /`);
      continue;
    }
    const base = rel.split('/').pop();
    const covered = rel === 'frontend/landing/index.html'
      ? suite.includes('`${BASE}/`')
      : rel === 'frontend/client/r.html'
        ? suite.includes('/r/')
        : suite.includes(base);
    if (!covered) missed.push(rel);
  }
  return { pages: pages.length - excluded.length, missed, excluded };
}

function anchorReport() {
  const idl = JSON.parse(read('backend/programs/idl/freightchain_pools.json'));
  const idlNames = idl.instructions.map((ix) => ix.name);
  const lib = read('backend/programs/freightchain_pools/src/lib.rs');
  const program = lib.slice(lib.indexOf('#[program]'));
  const fnNames = [...program.matchAll(/pub fn (\w+)/g)].map((m) => m[1]);
  const same = idlNames.length === fnNames.length && idlNames.every((n) => fnNames.includes(n));
  assert(same, `IDL instructions [${idlNames}] disagree with #[program] pub fn [${fnNames}]`);
  const blob = VALIDATOR_SCRIPTS.map((rel) => {
    assert(existsSync(join(ROOT, rel)), `validator script missing: ${rel}`);
    return read(rel);
  }).join('\n');
  const missed = idlNames.filter((name) => !new RegExp(`\\b${name.replaceAll('_', '[-_]')}\\b`).test(blob));
  return { total: idlNames.length, missed };
}

function flowRunnerReport(inv) {
  const routes = allRoutes(ROOT);
  const memory = read('backend/server/test/http/flows.spec.ts');
  const postgres = read('backend/server/test/integration/flows.integration.spec.ts');
  const side = new Map(routes.map((r) => [r.key, { memory: false, postgres: false }]));
  for (const f of inv.files.filter((row) => row.layer === 'server-scenarios')) {
    const fns = scenarioFns(read(f.rel));
    const onMemory = fns.some((name) => mentions(memory, name) > 0);
    const onPostgres = fns.some((name) => mentions(postgres, name) > 0);
    for (const c of caseRoutes(read(f.rel), routes, new Map())) {
      for (const key of c.keys) {
        const row = side.get(key);
        if (!row) continue;
        if (onMemory) row.memory = true;
        if (onPostgres) row.postgres = true;
      }
    }
  }
  const missed = [...side.entries()].filter(([, s]) => !s.memory || !s.postgres).map(([key, s]) => `${key} memory=${s.memory} postgres=${s.postgres}`);
  return { total: routes.length, missed };
}

function writeGate(inv, rep) {
  const zero = rep.routes.filter((r) => (r.scenario || 0) === 0);
  const single = rep.routes.filter((r) => r.scenario === 1);
  const runners = flowRunnerReport(inv);
  const html = htmlPageReport(chromeSuiteSource());
  const anchor = anchorReport();
  const ids = specIdSets();
  const live = liveTestSource();
  const unmapped = [...ids.required].filter((id) => !idMapped(live, id)).sort();
  const lines = [
    `zero-scenario routes: ${zero.length}`,
    `single-scenario routes: ${single.length}`,
    `http routes on both flow runners: ${runners.total - runners.missed.length}/${runners.total}`,
    `html pages covered by the headless Chrome suite: ${html.pages - html.missed.length}/${html.pages}`,
    ...html.excluded.map((line) => `excluded ${line}`),
    `anchor instructions on the local validator: ${anchor.total - anchor.missed.length}/${anchor.total}`,
    `required spec ids mapped to a non-skipped test: ${ids.required.size - unmapped.length}/${ids.required.size}`,
    `withdrawn spec ids not counted as passing: ${[...ids.withdrawn].sort().join(' ')}`,
  ];
  process.stdout.write(`${lines.join('\n')}\n`);
  assert(!zero.length, `zero-scenario routes: ${zero.map((r) => r.key).join(', ')}`);
  assert(!single.length, `single-scenario routes: ${single.map((r) => r.key).join(', ')}`);
  assert(!runners.missed.length, `routes missing a flow runner: ${runners.missed.join(', ')}`);
  assert(!html.missed.length, `html pages the headless Chrome suite does not open: ${html.missed.join(', ')}`);
  assert(anchor.total > 0 && !anchor.missed.length, `anchor instructions missing from the validator scripts: ${anchor.missed.join(', ')}`);
  assert(ids.required.size > 0 && !unmapped.length, `required spec ids with no non-skipped test: ${unmapped.join(', ')}`);
  assert(ids.withdrawn.has('E2E-T-01') && ids.withdrawn.has('E2E-T-06') && ![...ids.withdrawn].some((id) => ids.required.has(id)), `withdrawn ids must stay withdrawn: ${[...ids.withdrawn].join(' ')}`);
}

async function selfTest() {
  const commented = countCalls('a.ts', "it('yes', () => {});\n// it('no', () => {});\n/* test('nope', () => {}) */\nit.each([1, 2])('row', () => {});\n/re/.test(s);\nexpect(x).test('no');\nconst label = 'check(s)';\ncheck('redeems it (+3)');\nit('retries it (the week just turned)', () => {});\nit(r.name, () => {});\nconst live = `ok ${check(1)}`;");
  assert(commented.cases === 4 && commented.each === 1 && commented.checks === 2, `case count ${JSON.stringify(commented)}`);
  const rust = countCalls('a.rs', '#[test]\nfn a() {}\n// #[test]\nfn b() {}\n#[tokio::test]\nasync fn c() {}');
  assert(rust.cases === 2, `rust count ${rust.cases}`);
  const gaps = pyramidGaps(
    [{ path: 'application/services/ride.service.ts', text: '@Injectable()\nexport class RideService {}' }, { path: 'infrastructure/prisma/player.prisma.repository.ts', text: '@Injectable()\nexport class R { constructor(private prisma: PrismaService) {} }' }],
    new Set(['ride.service.spec.ts']),
    new Set(),
    ['domain/rides/ride.entity.ts'],
  );
  assert(gaps.missingUnit.length === 0, 'unit spec matched');
  assert(gaps.missingIntegration[0] === 'infrastructure/prisma/player.prisma.repository.ts', 'integration gap');
  assert(gaps.missingPure[0] === 'domain/rides/ride.entity.ts', 'pure gap');
  const spliced = spliceReadme(`# T\n${START}\nold\n${END}\n\n\`\`\`sh\nnpm test\n\`\`\``, 'new block');
  assert(spliced.includes('new block') && spliced.includes('npm test') && !spliced.includes('old'), 'splice');
  const tap = parseTap('# tests 2\n# pass 1\n# fail 0\n# skipped 1\n');
  assert(tap.passed === 1 && tap.failed === 0 && tap.skipped === 1, 'tap');
  const cargo = parseCargo('test result: ok. 3 passed; 0 failed; 1 ignored; 0 measured; 0 filtered out\ntest result: FAILED. 1 passed; 2 failed; 0 ignored\ntest foo ... FAILED\n');
  assert(cargo.passed === 4 && cargo.failed === 2 && cargo.skipped === 1 && cargo.failures[0] === 'foo', 'cargo');
  const store = { runs: [] };
  for (let i = 0; i < 14; i += 1) store.runs.push({ stage: 'client-unit', at: `2026-01-01T00:${String(i).padStart(2, '0')}:00.000Z` });
  store.runs.push({ stage: 'landing', at: '2026-01-02T00:00:00.000Z' });
  const keptPath = RUNS;
  // Cap logic, against a copy, without touching the real log.
  const capped = (() => {
    const by = new Map();
    for (const run of store.runs) {
      const list = by.get(run.stage) || [];
      list.push(run);
      by.set(run.stage, list);
    }
    const next = [];
    for (const list of by.values()) next.push(...list.slice(-KEEP));
    return next;
  })();
  assert(capped.filter((r) => r.stage === 'client-unit').length === KEEP && capped.some((r) => r.stage === 'landing'), 'cap');
  assert(keptPath.endsWith('runs.json'), 'runs path');
  const inv = inventory();
  assert(inv.layers.find((l) => l.id === 'server-domain').files >= 10, 'domain files');
  assert(inv.skills.some((s) => s.name === 'run-tests' && s.kind === 'test' && s.stage === 'e2e'), 'run-tests skill');
  assert(inv.skills.some((s) => s.name === 'game-audio' && s.kind === 'other'), 'game-audio kind');
  assert(inv.skills.some((s) => s.name === 'test-census' && s.kind === 'census'), 'census kind');
  assert(inv.harnesses.some((h) => h.rel.endsWith('e2e-browser.mjs') && h.runner === 'e2e.sh'), 'browser wired');
  assert(inv.harnesses.some((h) => h.rel.endsWith('e2e-tickets-stub.mjs') && h.runner === 'npm --prefix backend/server run test:tickets-stub'), 'tickets stub wired');
  assert(unsafeTestDatabase('') === '' && unsafeTestDatabase('postgresql://u:p@localhost:5432/freightchain_branch_test') === '' && unsafeTestDatabase('postgresql://u:p@localhost:5432/freightchain').includes('_test'), 'test database guard');
  assert(inv.scenarioSides.some((s) => s.name === 'analyticsScenarios' && s.memory === 2 && s.postgres === 2), 'analytics registered twice');
  assert(inv.pureReadable, 'pure list');
  assert(inv.layers.find((l) => l.id === 'client-headless').checks >= 36, 'headless checks');
  const lanes = schedule(['client-unit', 'server-unit', 'landing', 'server-integration', 'e2e', 'e2e:browser', 'program-check']);
  assert(lanes.map((lane) => lane.join('+')).join(' | ') === 'client-unit | server-unit+server-integration | landing | e2e+e2e:browser | program-check', `schedule ${JSON.stringify(lanes)}`);
  const together = fastTimingSentence([
    { stage: 'media', at: '2026-10-09T00:00:00.000Z', wallMs: 5000 },
    { stage: 'server-integration', at: '2026-10-09T00:00:00.100Z', wallMs: 20000 },
  ]);
  assert(together.includes('overlapped in 20.1 s') && together.includes('Added up, the stage times are 25.0 s'), together);
  const serial = fastTimingSentence([
    { stage: 'media', at: '2026-10-09T00:00:00.000Z', wallMs: 5000 },
    { stage: 'server-integration', at: '2026-10-09T00:00:05.000Z', wallMs: 20000 },
  ]);
  assert(serial.includes('25.0 s one after another'), serial);
  const md = render(inv, []);
  assert(md.includes('### Pyramid') && md.includes('### Test skills') && md.includes('`run-tests`'), 'render');
  assert(md.includes('pie title Static calls by band') && md.includes('"unit" :'), 'pie');
  const pie = bandChart({ layers: [
    { band: 'unit', cases: 10, checks: 0 },
    { band: 'unit', cases: 5, checks: 1 },
    { band: 'e2e', cases: 0, checks: 4 },
    { band: 'sim', cases: 0, checks: 0 },
  ] }).join('\n');
  assert(pie.includes('"unit" : 16') && pie.includes('"e2e" : 4') && !pie.includes('sim'), pie);
  const bars = wallChart([
    { stage: 'client-unit', wallMs: 121 },
    { stage: 'server-integration', wallMs: 33500 },
  ]).join('\n');
  assert(bars.includes('xychart-beta') && bars.includes('client-unit, server-integration') && bars.includes('0.1, 33.5') && bars.includes('0 --> 40'), bars);
  const line = historyChart([
    { stage: 'server-integration', status: 'pass', at: '2026-10-09T01:30:00.000Z', wallMs: 32800 },
    { stage: 'server-integration', status: 'fail', at: '2026-10-09T02:00:00.000Z', wallMs: 1000 },
    { stage: 'server-integration', status: 'pass', at: '2026-10-09T06:48:00.000Z', wallMs: 33500 },
  ], 'server-integration').join('\n');
  assert(line.includes('10-09-0130, 10-09-0200, 10-09-0648') && line.includes('line [32.8, 1, 33.5]'), line);
  assert(historyChart([{ stage: 'server-integration', at: '2026-10-09T01:30:00.000Z', wallMs: 1 }], 'server-integration').length === 0, 'one point');
  const report = join(tmpdir(), `fc-census-self-${process.pid}.json`);
  writeFileSync(report, JSON.stringify({ numPassedTests: 9, numFailedTests: 1, numPendingTests: 0, numTodoTests: 2, testResults: [{ name: 'a', assertionResults: [{ status: 'failed', fullName: 'boom' }] }] }));
  const fresh = parseVitest(report, Date.now() - 10_000);
  assert(fresh.passed === 9 && fresh.failed === 1 && fresh.skipped === 2 && fresh.failures[0] === 'boom', 'vitest');
  utimesSync(report, new Date(0), new Date(0));
  let stale = false;
  try { parseVitest(report, Date.now()); } catch { stale = true; }
  assert(stale, 'stale vitest report');
  unlinkSync(report);
  const gone = spawn(process.execPath, ['-e', ''], { detached: true, stdio: 'ignore' });
  await new Promise((resolve) => gone.on('close', resolve));
  killGroup(gone.pid, 'SIGTERM');
  const hung = await runProcess({ cwd: ROOT, cmd: process.execPath, args: ['-e', 'process.on("SIGTERM",()=>{}); setInterval(()=>{}, 1000);'], timeout: 400 });
  assert(hung.timedOut === true && hung.code === null && hung.wallMs < 10_000, `timeout kill ${hung.wallMs}`);
  // Feature coverage: route parsing, request matching, helpers, attribution, the e2e log, lcov / istanbul, grading.
  const ctrl = parseController('c.ts', "@Controller('api/rides')\nclass C {\n  @Post() @HttpCode(200)\n  create(@B() b) { return this.commandBus.execute(new CreateRideCommand(b)); }\n  @Get('pending')\n  pending() {}\n  @Get(':id')\n  get() { return this.queryBus.execute(new GetRideQuery()); }\n}");
  assert(ctrl.map((r) => `${r.key}=${r.name}`).join(' ') === 'POST /api/rides=create GET /api/rides/pending=pending GET /api/rides/:id=get', JSON.stringify(ctrl.map((r) => r.key)));
  assert(ctrl[0].bus[0] === 'CreateRideCommand', 'bus class');
  assert(matchRoute(ctrl, 'GET', '/api/rides/pending').name === 'pending' && matchRoute(ctrl, 'GET', '/api/rides/X?from=1').name === 'get' && !matchRoute(ctrl, 'POST', '/api/rides/X'), 'route match');
  const reqs = requestsIn("agent.post(`/api/rides/${ride.id}/start`).send(x); anon().get('/api/live?visitor=a'); re.test('/api/x');");
  assert(reqs.length === 2 && reqs[0].path === '/api/rides/X/start' && reqs[0].method === 'POST' && reqs[1].path === '/api/live', JSON.stringify(reqs));
  const sample = "const post = async () => agent.get('/api/rides/pending');\nconst open = async () => (await agent.post('/api/rides').send({}));\nit('a', async () => { await open(); await x.post('/api/nothing'); });\nit('b', async () => { await agent.get('/api/rides/9'); });";
  const cr = caseRoutes(sample, ctrl, new Map());
  assert(cr.length === 2 && [...cr[0].keys].join() === 'POST /api/rides' && [...cr[1].keys].join() === 'GET /api/rides/:id', JSON.stringify(cr.map((c) => [...c.keys])));
  const rows = new Map([['POST /api/auth/nonce', { feature: 'auth' }], ['POST /api/promo/redeem', { feature: 'promo' }]]);
  assert([...attributeCase({ title: 'x', keys: new Set(['POST /api/auth/nonce', 'POST /api/promo/redeem']) }, 'server-scenarios', rows)].join() === 'promo', 'setup routes yield');
  assert([...attributeCase({ title: 'x', keys: new Set(['POST /api/auth/nonce']) }, 'server-scenarios', rows)].join() === 'auth', 'setup only');
  assert([...attributeCase({ title: 'two redemptions race', keys: new Set(['POST /api/auth/nonce']) }, 'server-concurrency', rows)].join() === 'promo', 'race by title');
  const log = routesFromLog('2026 INFO  [HTTP] GET /api/rides/pending 200 {"event":"request","method":"GET","path":"/api/rides/pending","status":200}\nnoise\nx {"event":"request","method":"GET","path":"/api/rides/abc","status":404}\n', ctrl);
  assert(log.counts['GET /api/rides/pending'] === 1 && log.counts['GET /api/rides/:id'] === 1, JSON.stringify(log));
  assert(subjectOf('backend/server/test/unit/x/ride.service.spec.ts', ['backend/server/src/domain/shared/errors.ts'], new Map([['ride.service', ['backend/server/src/application/services/ride.service.ts']]])) === 'backend/server/src/application/services/ride.service.ts', 'subject by basename');
  const acc = addLcov({}, 'SF:js/a.js\nDA:1,1\nDA:2,0\nBRDA:1,0,0,1\nBRDA:1,0,1,-\nend_of_record\n', ROOT, join(ROOT, 'frontend/client'));
  addLcov(acc, 'SF:js/a.js\nDA:2,3\nBRDA:1,0,1,2\nend_of_record\nSF:test/t.test.mjs\nDA:1,1\nend_of_record\n', ROOT, join(ROOT, 'frontend/client'));
  const lc = linesFromLcov(acc);
  assert(JSON.stringify(lc) === '{"frontend/client/js/a.js":[2,2,2,2]}', JSON.stringify(lc));
  const ist = linesFromIstanbul(mergeIstanbul(
    { f: { path: join(ROOT, 'backend/server/src/a.ts'), statementMap: { 0: { start: { line: 1 } }, 1: { start: { line: 2 } } }, s: { 0: 1, 1: 0 }, b: { 0: [1, 0] } } },
    { f: { path: join(ROOT, 'backend/server/src/a.ts'), statementMap: { 0: { start: { line: 1 } }, 1: { start: { line: 2 } } }, s: { 0: 0, 1: 2 }, b: { 0: [0, 0] } } },
  ), ROOT);
  assert(JSON.stringify(ist) === '{"backend/server/src/a.ts":[2,2,1,2]}', JSON.stringify(ist));
  const base = { id: 'x', files: 4, withTest: 4, unitFiles: 1, routes: 2, routesHit: 2, scenarioCases: 3, race: 0, sim: 0, harness: [{ name: 'e2e-x.mjs' }], skills: [], e2eRouteHits: 2, lines: null };
  assert(gradeFeature({ ...base, e2eRouteHits: 0 }, true).grade === 'strong' && gradeFeature({ ...base, recordable: true, e2eRouteHits: 0 }, true).grade === 'fair', 'only e2e.sh features need recorded routes');
  assert(gradeFeature(base, true).grade === 'strong', 'strong');
  assert(gradeFeature({ ...base, routesHit: 1 }, true).grade === 'fair', 'fair');
  assert(gradeFeature({ ...base, withTest: 0, routesHit: 1 }, false).grade === 'thin', 'thin');
  assert(gradeFeature({ ...base, withTest: 0 }, false).grade === 'thin', 'bare files are thin');
  assert(gradeFeature({ ...base, unitFiles: 0, scenarioCases: 0, harness: [] }, false).grade === 'untested', 'untested');
  const routes = allRoutes(ROOT);
  assert(routes.length >= 60 && routes.every((r) => r.name), `routes ${routes.length}`);
  assert(spawnedNodeScripts("spawn(process.execPath, ['scripts/e2e-blinks.mjs'], { cwd: server });").join() === 'scripts/e2e-blinks.mjs', 'validator wrapper retains its Chrome child in page coverage');
  const rep = reportOf(inv);
  const thinRoutes = rep.routes.filter((r) => (r.scenario || 0) < 2).map((r) => `${r.scenario || 0} ${r.key}`);
  assert(!thinRoutes.length, `routes with fewer than 2 scenario cases: ${thinRoutes.join(', ')}`);
  assert(rep.flows.every((f) => !f.unknown.length), `flow steps that are no route: ${rep.flows.flatMap((f) => f.unknown).join(', ')}`);
  assert(rep.routes.every((r) => r.feature), `routes no feature owns: ${rep.routes.filter((r) => !r.feature).map((r) => r.key).join(', ')}`);
  assert(!rep.unmapped.length, `source files no feature owns: ${rep.unmapped.join(', ')}`);
  assert(!rep.unattributed.length, `tests attributed to no feature: ${rep.unattributed.join(', ')}`);
  const named = new Set(FEATURES.flatMap((f) => f.e2e || []));
  const loose = inv.harnesses.filter((h) => !named.has(h.rel.split('/').pop()));
  assert(!loose.length, `e2e harnesses no feature lists: ${loose.map((h) => h.rel).join(', ')}`);
  assert(rep.controllers.length === new Set(routes.map((r) => r.controller)).size, 'controllers');
  writeGate(inv, rep);
  process.stdout.write('self-test ok\n');
}

main(process.argv.slice(2)).catch((err) => {
  process.stderr.write(`${err.stack || err.message}\n`);
  process.exitCode = 1;
});
