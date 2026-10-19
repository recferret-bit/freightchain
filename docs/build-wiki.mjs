/* Rebuild docs/wiki-catalog.js from the docs tree. Run: node docs/build-wiki.mjs */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = here;
const skip = new Set(['wiki.html', 'wiki.css', 'wiki.js', 'wiki-render.js', 'wiki-catalog.js', 'build-wiki.mjs']);

const dirTitles = {
  spec: 'Product specification',
  plan: 'Launch and preseason',
  tech: 'Architecture and explainers',
  testing: 'Testing and coverage',
  legal: 'Legal texts',
  insights: 'Insights and audits',
  agents: 'Agent guides',
  research: 'Research',
  analytics: 'Analytics',
  generated: 'Generated checks',
  img: 'Figures',
  updates: 'Update notes',
  reviews: 'Reviews',
  'audit-2026-10': 'Audit, October 2026',
  traction: 'Traction',
  'anti-cheat': 'Anti-cheat',
  assets: 'Assets',
  'localnet-e2e': 'Localnet end-to-end',
  'pool-program': 'Pool program',
  'replay-and-donations': 'Replays and donations',
  ten4: 'TEN4',
  'verified-play': 'Verified play',
  'test-coverage': 'Test coverage',
};

const dirBlurbs = {
  spec: 'As-built behavior, target decisions, and the open questions.',
  plan: 'The launch roadmap, the devnet preseason, owner tasks, and research.',
  tech: 'Server layout, configuration, the escrow program, and the visual explainers.',
  testing: 'The coverage bar, the end-to-end plan, manual checks, and the test census.',
  legal: 'Terms, privacy, and the contest rules the site renders.',
  insights: 'Analytics reference, traction snapshots, and security reviews.',
  agents: 'Operational maps for coding agents. Read the topic file before changing that area.',
  research: 'Jurisdiction, tax, and operator notes behind the launch plan.',
  analytics: 'PostHog events, funnels, and the review notes that explain them.',
  generated: 'Machine output from the analytics checks. Useful as evidence, not as a spec.',
  img: 'Screenshots that the analytics pages refer to.',
  updates: 'Short review passes. Each one says what the analytics check found.',
  reviews: 'Security and design reviews kept next to the product notes.',
  'audit-2026-10': 'The October 2026 security-audit fix plan.',
  traction: 'The latest public traction snapshot.',
  'anti-cheat': 'How a recorded shift is judged, drawn as a one-page explainer.',
  assets: 'Small figures used by the technical notes.',
  'localnet-e2e': 'What the local-validator money test covers.',
  'pool-program': 'The escrow program, drawn as a one-page explainer.',
  'replay-and-donations': 'Live watch, replays, and donations on one page.',
  ten4: 'The TEN4 token, the garage, and the design stress-test.',
  'verified-play': 'How a shift is recorded and checked, in plain language.',
  'test-coverage': 'The test census as a page, with the same numbers as the Markdown note.',
};

const preferredFiles = {
  agents: ['repo.md', 'client.md', 'world.md', 'gameplay.md', 'server.md', 'admin-ops.md', 'ten4-localnet.md', 'media.md', 'landing.md', 'verifying.md', 'deploy.md'],
  spec: ['README.md', 'PROCESS.md', 'PRODUCT.md', 'DECISIONS.md', 'OPEN.md', 'rides.md', 'anticheat.md', 'minigames.md', 'pool.md', 'referral.md', 'promocodes.md', 'ten4.md', 'web3_solana.md', 'platform_services.md', 'replays_streams.md', 'admin_security.md', 'backend_contract.md', 'e2e.md', 'legal.md'],
  plan: ['README.md', 'MASTER_PLAN.md', 'DEVNET_PRESEASON.md', 'OWNER_TASKS.md', 'SIWS_SNS_PROJECT.md'],
  tech: ['backend-architecture.md', 'configuration.md', 'program-deploy.md', 'escrow-open-items.md'],
  'tech/ten4': ['index.html', 'grill.html', 'ten4.css'],
  testing: ['COVERAGE_CONTRACT.md', 'E2E_PLAN.md', 'MANUAL_TESTS.md', 'IMPLEMENTATION_PLAN.md', 'test-coverage.md'],
  legal: ['TERMS.md', 'PRIVACY.md', 'OFFICIAL_RULES.md', 'PRESEASON_RULES.md', 'PRESEASON_RULES_RU.md'],
};

const fileTitles = {
  'insights/traction/latest.json': 'Latest traction snapshot',
  'insights/analytics/generated/checks.json': 'Check results',
  'insights/analytics/generated/audit.json': 'Audit result',
  'insights/analytics/generated/e2e.log': 'Browser test log',
  'insights/analytics/generated/landing-test.log': 'Landing test log',
  'insights/analytics/analytics.css': 'Analytics page styles',
  'tech/assets/split.svg': 'Split diagram',
  'insights/analytics/img/posthog-dashboard.png': 'PostHog dashboard',
  'insights/analytics/img/posthog-acquisition.png': 'PostHog acquisition',
  'insights/analytics/img/posthog-insights.png': 'PostHog insights',
};

const preferredDirs = {
  '': ['spec', 'plan', 'tech', 'testing', 'legal', 'insights', 'agents'],
  tech: ['anti-cheat', 'verified-play', 'pool-program', 'localnet-e2e', 'replay-and-donations', 'ten4', 'assets'],
  insights: ['analytics', 'reviews', 'traction'],
};

function sortNames(names, preferred) {
  const rank = new Map((preferred || []).map((name, i) => [name, i]));
  return names.slice().sort((a, b) => {
    const ra = rank.has(a) ? rank.get(a) : 1000;
    const rb = rank.has(b) ? rank.get(b) : 1000;
    if (ra !== rb) return ra - rb;
    return a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
  });
}

function humanName(filename) {
  const base = filename.replace(/\.[^.]+$/, '');
  return base.replace(/[_-]+/g, ' ').replace(/\b\p{L}/gu, (c) => c.toUpperCase());
}

function mdTitle(text, fallback) {
  const m = text.match(/^#\s+(.+)$/m);
  if (!m) return fallback;
  return m[1].replace(/\[([^\]]+)\]\([^)]*\)/g, '$1').replace(/[`*_]/g, '').trim() || fallback;
}

function decodeBasic(s) {
  return s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'");
}

function htmlMeta(text, fallback) {
  const title = (text.match(/<title>([^<]*)<\/title>/i) || [])[1];
  const h1 = (text.match(/<h1[^>]*>([^<]*)<\/h1>/i) || [])[1];
  const desc = (text.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']*)["']/i)
    || text.match(/<meta[^>]+content=["']([^"']*)["'][^>]+name=["']description["']/i) || [])[1];
  const lede = (text.match(/<p class="lede">([\s\S]*?)<\/p>/i) || [])[1];
  const description = decodeBasic((lede || desc || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim());
  return {
    title: decodeBasic((title || h1 || fallback).trim()),
    description: description.length > 280 ? description.slice(0, 276).replace(/\s+\S*$/, '') + '…' : description,
  };
}

function kindOf(name) {
  const ext = path.extname(name).slice(1).toLowerCase();
  if (ext === 'md') return 'md';
  if (ext === 'html') return 'html';
  if (ext === 'css') return 'css';
  if (ext === 'json') return 'json';
  if (ext === 'log') return 'log';
  if (ext === 'svg') return 'svg';
  if (ext === 'png' || ext === 'jpg' || ext === 'jpeg' || ext === 'webp' || ext === 'gif') return 'png';
  return 'file';
}

function walk(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true })
    .filter((ent) => ent.name !== '.DS_Store' && !ent.name.startsWith('.'));
  const relDir = path.relative(root, dir);
  const files = [];
  const dirs = [];
  for (const ent of entries) {
    if (relDir === '' && skip.has(ent.name)) continue;
    const abs = path.join(dir, ent.name);
    if (ent.isDirectory()) dirs.push(walk(abs));
    else if (ent.isFile()) files.push(abs);
  }
  return { abs: dir, rel: relDir, files, dirs };
}

function flatten(node, files, tree) {
  const rel = node.rel.split(path.sep).join('/');
  const name = rel === '' ? '' : rel.split('/').pop();
  const fileRels = [];
  for (const abs of node.files) {
    const fileRel = path.relative(root, abs).split(path.sep).join('/');
    const base = path.basename(abs);
    const kind = kindOf(base);
    const bytes = fs.statSync(abs).size;
    const rec = { title: fileTitles[fileRel] || humanName(base), kind, bytes };
    if (kind === 'md' || kind === 'css' || kind === 'json' || kind === 'log') {
      rec.text = fs.readFileSync(abs, 'utf8');
      if (kind === 'md') rec.title = mdTitle(rec.text, rec.title);
      if (kind === 'css' && !fileTitles[fileRel]) {
        const parent = path.dirname(fileRel).split('/').pop();
        rec.title = (dirTitles[parent] || humanName(parent)) + ' styles';
      }
    } else if (kind === 'html') {
      const meta = htmlMeta(fs.readFileSync(abs, 'utf8'), rec.title);
      rec.title = meta.title;
      if (meta.description) rec.description = meta.description;
    }
    files[fileRel] = rec;
    fileRels.push(fileRel);
  }
  const names = fileRels.map((p) => p.split('/').pop());
  const head = [];
  for (const special of ['README.md', 'index.html', 'index.md']) {
    if (names.includes(special) && !(preferredFiles[rel] || []).includes(special)) head.push(special);
  }
  const orderedNames = head.concat(sortNames(names.filter((n) => !head.includes(n)), preferredFiles[rel]));
  const ordered = orderedNames.map((n) => (rel ? rel + '/' : '') + n);
  const childDirs = sortNames(node.dirs.map((d) => path.basename(d.abs)), preferredDirs[rel] || [])
    .map((n) => node.dirs.find((d) => path.basename(d.abs) === n))
    .map((d) => flatten(d, files, null));
  const branch = {
    path: rel,
    name,
    title: dirTitles[name] || (rel === '' ? 'Documentation' : humanName(name)),
    blurb: dirBlurbs[name] || dirBlurbs[rel] || '',
    files: ordered,
    dirs: childDirs,
  };
  return branch;
}

function loadRenderer() {
  const sandbox = { window: {}, console };
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(root, 'wiki-render.js'), 'utf8'), sandbox);
  return sandbox.window.WikiRender;
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

function selfTest(render) {
  const lookup = (p) => {
    if (p === 'spec/README.md' || p === 'legal/PRIVACY.md' || p === 'PRIVACY.md') return 'file';
    if (p === 'spec' || p === 'legal' || p === 'tech') return 'dir';
    return null;
  };
  const sample = render([
    '# Title',
    '',
    'A **bold** claim and a `code` span. free_rides stays plain. _note_ is emphasis.',
    '',
    'See [the spec](./spec/README.md) and [privacy](legal/PRIVACY.md).',
    '',
    '| A | B |',
    '| --- | ---: |',
    '| `x` | **y** |',
    '',
    '- Tiers:',
    '  - one',
    '  - two',
    '- Next item',
    '',
    '- [ ] open item',
    '- [x] done item',
    '',
    '```',
    '# not a heading',
    '```',
    '',
    '> A quoted line',
    '',
    '---',
    '',
    '---',
    '',
    '<img src=x onerror=alert(1)>',
  ].join('\n'), { from: 'README.md', lookup, omitFirstH1: true });

  assert(!sample.html.includes('<h1'), 'first heading is the page title, not repeated');
  assert(sample.html.includes('<strong>bold</strong>'), 'bold');
  assert(sample.html.includes('<code>code</code>'), 'code span');
  assert(sample.html.includes('free_rides'), 'snake case');
  assert(!sample.html.includes('free<em>'), 'underscore inside a word');
  assert(sample.html.includes('<em>note</em>'), 'emphasis');
  assert(sample.html.includes('href="#/spec/README.md"'), 'relative spec link');
  assert(sample.html.includes('href="#/legal/PRIVACY.md"'), 'sibling link stays in the folder');
  assert(sample.html.includes('class="a-right"'), 'table alignment');
  assert(sample.html.includes('<li>Tiers:<ul>') || sample.html.includes('<li><p>Tiers:</p><ul>'), 'nested list');
  assert(sample.html.includes('class="task"'), 'task list');
  assert(sample.html.includes('data-on="1"'), 'checked task');
  assert((sample.html.match(/<hr class="divider">/g) || []).length === 1, 'repeated rules collapse');
  assert(sample.html.includes('<pre><code># not a heading'), 'fence is not a heading');
  assert(sample.html.includes('<blockquote>'), 'quote');
  assert(!sample.html.includes('<img'), 'raw html is escaped');
  assert(sample.html.includes('&lt;img'), 'escaped img');
  assert(!sample.html.includes('<script'), 'no script tag');

  const outside = render('[agents](../AGENTS.md)', { from: 'README.md', lookup });
  assert(outside.html.includes('href="../AGENTS.md"'), 'link that leaves docs/');

  const rides = fs.readFileSync(path.join(root, 'spec/rides.md'), 'utf8');
  const ridesHtml = render(rides, { from: 'spec/rides.md', lookup: () => 'file', omitFirstH1: true });
  assert(ridesHtml.html.includes('<ul>'), 'rides list');
  assert(ridesHtml.html.includes('free-1c'), 'rides body');
  assert(!ridesHtml.html.includes('<script'), 'rides has no raw script');

  const details = fs.readFileSync(path.join(root, 'testing/test-coverage.md'), 'utf8');
  const detailsHtml = render(details, { from: 'testing/test-coverage.md', lookup: () => null, omitFirstH1: true });
  assert(detailsHtml.html.includes('<details class="fold">'), 'details fold');
  assert(detailsHtml.html.includes('<table>'), 'table inside details');

  const terms = fs.readFileSync(path.join(root, 'legal/TERMS.md'), 'utf8');
  const termsHtml = render(terms, { from: 'legal/TERMS.md', lookup, omitFirstH1: true });
  assert(termsHtml.html.includes('class="task"'), 'terms checklist');
  assert(termsHtml.toc.length > 3, 'terms table of contents');

  for (const rel of ['spec/anticheat.md', 'agents/repo.md', 'spec/DECISIONS.md', 'README.md']) {
    const src = fs.readFileSync(path.join(root, rel), 'utf8');
    const out = render(src, { from: rel, lookup: () => 'file', omitFirstH1: true });
    assert(out.html.length > 100, rel + ' rendered');
    assert(!/<script/i.test(out.html), rel + ' escaped script');
  }
}

const renderer = loadRenderer();
selfTest(renderer.renderMarkdown);

const tree = flatten(walk(root), {}, null);
const files = {};
flatten(walk(root), files, null);

const built = new Date().toISOString().slice(0, 10);
const payload = { built, files, tree };
let json = JSON.stringify(payload).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
const out = '/* Generated by docs/build-wiki.mjs on ' + built + '. Do not edit. */\nwindow.WIKI_CATALOG = ' + json + ';\n';
fs.writeFileSync(path.join(root, 'wiki-catalog.js'), out);

function count(node) {
  return node.files.length + node.dirs.reduce((n, d) => n + count(d), 0);
}
const bytes = Buffer.byteLength(out);
console.log('wiki-catalog.js  ' + tree.dirs.length + ' sections  ' + count(tree) + ' pages  ' + (bytes / 1024 / 1024).toFixed(2) + ' MB');
for (const dir of tree.dirs) {
  console.log('  ' + dir.path + '  ' + count(dir) + ' pages  ' + dir.dirs.map((d) => d.path).join(', '));
}
