#!/usr/bin/env node
/**
 * generate-html-report.mjs
 *
 * Writes two standalone pages in the report directory:
 *   report.html              the quorum review
 *   findings-by-model.html   each model's own findings, counted by severity
 *
 * The target (name, source, ref, commit) comes from <report-dir>/meta.json, written by orchestrate.sh.
 * Everything an auditor wrote is untrusted (it was derived from a third-party repo), so it is HTML-escaped.
 *
 * Usage:
 *   node audit/scripts/generate-html-report.mjs [report-dir]   (default: newest dir under audit/reports)
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import { loadAuditors, adapterOf, readReportText, readReportJson, writeReportFile } from './report-contract.mjs';

const scriptsDir = path.dirname(fileURLToPath(import.meta.url));

function newestReportDir() {
  const root = path.join(scriptsDir, '..', 'reports');
  if (!fs.existsSync(root)) return null;
  return fs.readdirSync(root, { withFileTypes: true })
    .filter((d) => d.isDirectory() && fs.existsSync(path.join(root, d.name, 'auditors')))
    .map((d) => ({ dir: path.join(root, d.name), mtime: fs.statSync(path.join(root, d.name)).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime)[0]?.dir || null;
}

const reportDir = process.argv[2] || newestReportDir();
if (!reportDir) {
  console.error('No report directory given and none found under audit/reports');
  process.exit(1);
}
const assetsDir = path.join(reportDir, 'assets');

// Revalidate current inputs; an old scored file is not evidence of completeness.
try {
  execFileSync('node', [path.join(scriptsDir, 'verify-and-adjudicate.mjs'), reportDir], { stdio: 'inherit' });
} catch (err) {
  if (err.status !== 2 || !fs.existsSync(path.join(reportDir, 'report-health.json'))) throw err;
}

const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const readJson = (file, fallback) => {
  try { return readReportJson(reportDir, file, 64 * 1024 * 1024); } catch { return fallback; }
};

const findings = readReportJson(reportDir, 'findings-and-scores.json', 64 * 1024 * 1024);
const verifiedSafe = readJson('verified-safe.json', []);
const { meta, reports, health: currentHealth } = loadAuditors(reportDir);
const health = readJson('report-health.json', currentHealth);
const nonce = crypto.randomBytes(24).toString('base64');
const policy = `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'`;
const validationBanner = `<div class="visuals-section"><p class="note"><strong>${health.state === 'validated_outputs' ? 'OUTPUTS VALIDATED — NOT A CLEAN-AUDIT CERTIFICATE' : 'INCOMPLETE REVIEW'}</strong>. These are unverified model assertions. No execution evidence or served-model/provider attestation was collected. Zero findings is not proof of safety.</p>${(health.errors || []).map((e) => `<p class="note">${esc(e)}</p>`).join('')}</div>`;
const workerManifest = readJson('workers.json', {});
const workerJobs = Array.isArray(workerManifest?.jobs) ? workerManifest.jobs.slice(0, 1000).filter((j) => j && typeof j.name === 'string' && typeof j.state === 'string') : [];
const isolationBanner = meta.isolation?.policy === 'read_only_source_review'
  ? `<div class="visuals-section"><div class="section-title"><span>Read-only worker isolation policy</span></div><p class="note">Live transport is blocked: subscription delegation and tools-disabled transport are not verified. No host reviewer fallback, model call, lead scanner or target build was started. These are parent-recorded blocked jobs, not successful reviews.</p>${workerJobs.map((j) => `<p class="note">${esc(j.name)} · ${esc(j.state)} · ${esc(j.reason || '')}</p>`).join('')}<p class="note">Source snapshot digest: <code>${esc(meta.isolation.sourceDigest)}</code>. Named secret exclusions do not certify secret-free source.</p></div>`
  : meta.isolation?.policy === 'report_finalization'
    ? `<div class="visuals-section"><div class="section-title"><span>Saved review finalization</span></div><p class="note">This phase only collected a report from the saved AGY conversation. No new Docker container, build, test, scanner or source inspection ran. Sandbox coverage below was copied from <code>${esc(meta.recovery?.fromReport || 'the prior review')}</code> for the same captured source digest. The original timed-out attempt remains recorded; untested coverage is not a pass.</p></div>`
    : '';

let sandboxMd = '';
try { sandboxMd = readReportText(reportDir, 'harness/sandbox.md'); } catch { /* disclose unavailable coverage */ }
function sandboxBanner(md) {
  const rows = [];
  for (const line of String(md || '').split('\n')) {
    const match = line.match(/^\| (.+?) \| (ran|failed|impossible) \| (.*) \|$/);
    if (!match || match[1] === 'check') continue;
    rows.push({ name: match[1], result: match[2], detail: match[3] });
  }
  if (!rows.length) return '<div class="visuals-section"><p class="note">Sandbox coverage unavailable or invalid — not a pass.</p></div>';
  const n = (kind) => rows.filter((row) => row.result === kind).length;
  const standing = (row) => /No production host or RPC was contacted|Deployed program bytes were not compared/.test(row.detail);
  const gaps = rows.filter((row) => row.result !== 'ran' && !standing(row)).slice(0, 8);
  const gapText = gaps.map((row) => `${row.name} (${row.result})`).join('; ');
  return `
    <div class="visuals-section">
      <div class="section-title"><span>Sandbox coverage</span></div>
      <p class="note">${n('ran')} finished, ${n('failed')} failed, ${n('impossible')} not started, as reported by the sandbox. These records share storage with target processes and are not authenticated execution evidence. A failed or not-started row is not a pass.${gapText ? ` ${esc(gapText)}.` : ''} Intended policy: no production probes; deployed bytes are compared only with an operator-selected <code>--rpc</code> URL.</p>
    </div>`;
}
const sandboxBannerHtml = sandboxBanner(sandboxMd);

const targetName = meta.name || path.basename(path.resolve(reportDir));
const dateLabel = (meta.date ? new Date(meta.date) : new Date()).toISOString().slice(0, 10);
const sourceLine = [meta.source, meta.ref && `@ ${meta.ref}`, meta.commit && `(${meta.commit})`].filter(Boolean).join(' ');
const reviewers = Array.isArray(meta.agents)
  ? meta.agents.map((a) => (meta.models && meta.models[a]) ? `${a} (requested: ${meta.models[a]}; served identity unverified)` : `${a} (served identity unverified)`).join(', ')
  : '';

// Assets share the report's trust boundary; display source, never active SVG.
const diagrams = fs.existsSync(assetsDir)
  ? fs.readdirSync(assetsDir).filter((f) => f.endsWith('.svg') && fs.lstatSync(path.join(assetsDir, f)).isFile() && fs.statSync(path.join(assetsDir, f)).size <= 512 * 1024).sort().map((f) => ({
      title: f.replace(/\.svg$/, '').replace(/[-_]+/g, ' '),
      svg: readReportText(reportDir, `assets/${f}`, 512 * 1024),
    }))
  : [];

// Compute summary counts
const counts = {
  total: findings.length,
  high: findings.filter((f) => f.severity === 'high' || f.severity === 'critical').length, // critical shares the red card
  medium: findings.filter((f) => f.severity === 'medium').length,
  low: findings.filter((f) => f.severity === 'low').length,
  info: findings.filter((f) => f.severity === 'info').length,
  modelAgreement: findings.filter((f) => f.status === 'MODEL_AGREEMENT').length,
};

// Same generic surfaces as orchestrate.sh
const SURFACE_NAMES = {
  S1: 'Identity & Access Control',
  S2: 'Input Handling & Injection',
  S3: 'Business Logic & Value Flows',
  S4: 'Secrets, Config & Infra',
  S5: 'Dependencies & Supply Chain',
  S6: 'Client & Web Surface',
};
const surfaces = Object.fromEntries(
  Object.keys(SURFACE_NAMES).map((id) => {
    const rows = findings.filter((f) => String(f.surface).toUpperCase().startsWith(id));
    const levels = { high: 0, medium: 0, low: 0, info: 0 };
    for (const f of rows) {
      const sev = f.severity === 'critical' ? 'high' : f.severity;
      if (Object.hasOwn(levels, sev)) levels[sev] += 1;
    }
    const tone = levels.high ? 'high' : levels.medium ? 'medium' : levels.low ? 'low' : levels.info ? 'info' : 'zero';
    return [id, { total: rows.length, tone, ...levels }];
  }),
);

// Raw findings per model. A cluster in findings-and-scores.json is shared, so it is the wrong count.
const SEVERITY_LEVELS = ['high', 'medium', 'low', 'info'];
const MODEL_ORDER = ['claude', 'gpt', 'codex', 'grok', 'agy', 'gemini'];

function severityLevel(raw) {
  const token = String(raw ?? '').toLowerCase().match(/[a-z]+/)?.[0] || '';
  if (token === 'critical') return 'high';
  return token;
}

function loadModelRows() {
  const buckets = new Map();
  const ensure = (key) => {
    if (!buckets.has(key)) buckets.set(key, { key, counts: {} });
    return buckets.get(key);
  };
  {
    for (const { name, data: items } of reports) {
      const key = adapterOf(name);
      const row = ensure(key);
      for (const item of items) {
        if (!item || typeof item !== 'object' || item.verified_safe) continue;
        if (!item.severity && !item.title) continue;
        const level = severityLevel(item.severity);
        if (!level) continue;
        row.counts[level] = (row.counts[level] || 0) + 1;
      }
    }
  }
  if (Array.isArray(meta.agents)) {
    for (const agent of meta.agents) ensure(String(agent).toLowerCase());
  }
  const extra = [];
  for (const row of buckets.values()) {
    for (const level of Object.keys(row.counts)) {
      if (!SEVERITY_LEVELS.includes(level) && !extra.includes(level)) extra.push(level);
    }
  }
  const levels = [...SEVERITY_LEVELS, ...extra.sort()];
  const rows = [...buckets.values()].map((row) => {
    const slug = meta.models && meta.models[row.key];
    const total = levels.reduce((n, level) => n + (row.counts[level] || 0), 0);
    const available = reports.some((r) => adapterOf(r.name) === row.key);
    return { ...row, label: `${slug || row.key} (requested; served identity unverified)${available ? '' : ' — no valid outputs'}`, total };
  }).sort((a, b) => {
    const ia = MODEL_ORDER.indexOf(a.key);
    const ib = MODEL_ORDER.indexOf(b.key);
    if (ia === -1 && ib === -1) return a.key.localeCompare(b.key);
    if (ia === -1) return 1;
    if (ib === -1) return -1;
    return ia - ib;
  });
  return { rows, levels };
}

const { rows: modelRows, levels: modelLevels } = loadModelRows();
const modelMax = Math.max(1, ...modelRows.map((r) => r.total));

function modelChart() {
  if (!modelRows.length) return '<p class="note">No auditor findings were filed.</p>';
  return modelRows.map((row) => {
    const width = row.total ? (row.total / modelMax) * 100 : 0;
    const segs = modelLevels.map((level) => {
      const n = row.counts[level] || 0;
      if (!n) return '';
      const cls = SEVERITY_LEVELS.includes(level) ? level : 'other';
      return `<span class="seg seg-${cls}" style="width:${((n / row.total) * 100).toFixed(2)}%"></span>`;
    }).join('');
    return `<div class="chart-row">
      <div class="chart-name">${esc(row.label)}</div>
      <div class="chart-track"><div class="chart-fill" style="width:${width.toFixed(2)}%">${segs}</div></div>
      <div class="chart-total">${row.total}</div>
    </div>`;
  }).join('');
}

function modelTable() {
  const head = modelLevels.map((level) => `<th>${esc(level)}</th>`).join('');
  const body = modelRows.map((row) => {
    const cells = modelLevels.map((level) => {
      const n = row.counts[level] || 0;
      const cls = !n ? 'zero' : (level === 'high' ? 'high' : '');
      return `<td${cls ? ` class="${cls}"` : ''}>${n}</td>`;
    }).join('');
    return `<tr><th scope="row">${esc(row.label)}</th>${cells}<td>${row.total}</td></tr>`;
  }).join('');
  const totals = modelLevels.map((level) => {
    const n = modelRows.reduce((sum, row) => sum + (row.counts[level] || 0), 0);
    return `<td${level === 'high' && n ? ' class="high"' : ''}>${n}</td>`;
  }).join('');
  const grand = modelRows.reduce((sum, row) => sum + row.total, 0);
  return `<table>
    <thead><tr><th>Model</th>${head}<th>Total</th></tr></thead>
    <tbody>${body}</tbody>
    <tfoot><tr><th scope="row">All models</th>${totals}<td>${grand}</td></tr></tfoot>
  </table>`;
}

const modelHtml = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="${esc(policy)}">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${esc(targetName)} — Findings by model</title>
  <style>
    :root {
      --ground: #121410;
      --panel: #1a1c18;
      --bone: #e6e2d6;
      --mute: #8a877c;
      --rule: #2e312b;
      --brass: #9c7c45;
      --harm: #a33b32;
      --harm-text: #f08a80;
      --font-mono: "IBM Plex Mono", ui-monospace, SFMono-Regular, Menlo, monospace;
      --font-sans: "IBM Plex Sans", "Helvetica Neue", sans-serif;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      background: var(--ground);
      color: var(--bone);
      font-family: var(--font-sans);
      font-size: 15.5px;
      line-height: 1.5;
      padding-bottom: 64px;
    }
    .container { max-width: 820px; margin: 0 auto; padding: 0 24px; }
    header { border-bottom: 1px solid var(--rule); padding: 36px 0 22px; margin-bottom: 22px; }
    .kicker {
      font-family: var(--font-mono);
      font-size: 11px;
      font-weight: 500;
      letter-spacing: 0.16em;
      text-transform: uppercase;
      color: var(--brass);
      margin-bottom: 12px;
    }
    h1 { font-size: 26px; font-weight: 500; letter-spacing: -0.015em; line-height: 1.15; }
    .note { color: var(--mute); font-size: 14.5px; max-width: 62ch; margin-top: 10px; }
    .nav { margin-top: 16px; font-family: var(--font-mono); font-size: 12px; letter-spacing: 0.08em; text-transform: uppercase; }
    .nav a { color: var(--brass); text-decoration: none; border-bottom: 1px solid var(--brass); }
    .nav a:hover { color: var(--bone); }
    .legend { display: flex; flex-wrap: wrap; gap: 18px; list-style: none; margin-bottom: 8px; }
    .legend li {
      display: flex;
      align-items: center;
      gap: 8px;
      font-family: var(--font-mono);
      font-size: 11px;
      letter-spacing: 0.12em;
      text-transform: uppercase;
      color: var(--mute);
    }
    .swatch { width: 10px; height: 10px; display: inline-block; }
    .swatch-high { background: var(--harm); }
    .swatch-medium { background: var(--brass); }
    .swatch-low { background: var(--bone); }
    .swatch-info, .swatch-other { background: var(--mute); }
    .chart-row {
      display: grid;
      grid-template-columns: minmax(148px, 16rem) 1fr 2.6rem;
      gap: 14px;
      align-items: center;
      padding: 9px 0;
      border-bottom: 1px solid var(--rule);
    }
    .chart-name { font-family: var(--font-mono); font-size: 12.5px; color: var(--bone); }
    .chart-track { height: 14px; }
    .chart-fill { display: flex; height: 14px; }
    .seg { display: block; height: 14px; }
    .seg-high { background: var(--harm); }
    .seg-medium { background: var(--brass); }
    .seg-low { background: var(--bone); }
    .seg-info, .seg-other { background: var(--mute); }
    .chart-total {
      font-family: var(--font-mono);
      font-size: 13px;
      font-weight: 500;
      text-align: right;
      font-variant-numeric: tabular-nums;
    }
    h2 {
      font-size: 18px;
      font-weight: 500;
      margin: 32px 0 8px;
      padding-bottom: 6px;
      border-bottom: 1px solid var(--brass);
      display: inline-block;
    }
    table { width: 100%; border-collapse: collapse; margin-top: 8px; }
    th, td {
      padding: 10px 12px 10px 0;
      border-bottom: 1px solid var(--rule);
      text-align: right;
      font-variant-numeric: tabular-nums;
    }
    th {
      font-family: var(--font-mono);
      font-size: 11px;
      font-weight: 500;
      letter-spacing: 0.1em;
      text-transform: uppercase;
      color: var(--mute);
    }
    td { font-family: var(--font-mono); font-size: 13px; }
    th:first-child, td:first-child, tbody th, tfoot th { text-align: left; color: var(--bone); }
    tbody th { font-family: var(--font-mono); font-size: 12.5px; font-weight: 500; letter-spacing: 0; text-transform: none; white-space: nowrap; }
    td.high, tfoot td.high { color: var(--harm-text); }
    td.zero { color: var(--mute); }
    tfoot th, tfoot td { border-bottom: 0; border-top: 1px solid var(--brass); }
    @media (max-width: 640px) {
      .chart-row { grid-template-columns: 1fr 2.6rem; }
      .chart-track { grid-column: 1 / -1; }
    }
  </style>
</head>
<body>
  <header>
    <div class="container">
      <div class="kicker">Findings by model · ${esc(dateLabel)}</div>
      <h1>${esc(targetName)}</h1>
      <p class="note">Each bar is that model's own findings, counted from its auditor file before findings are merged. Critical is counted with high.</p>
      <p class="nav"><a href="report.html">Full report</a></p>
    </div>
  </header>
  <div class="container">
    ${validationBanner}
    ${isolationBanner}
    <ul class="legend">
      ${modelLevels.map((level) => {
        const cls = SEVERITY_LEVELS.includes(level) ? level : 'other';
        return `<li><i class="swatch swatch-${cls}"></i>${esc(level)}</li>`;
      }).join('')}
    </ul>
    <div class="chart" aria-hidden="true">${modelChart()}</div>
    <h2>Counts</h2>
    ${modelTable()}
  </div>
</body>
</html>
`;

const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="${esc(policy)}">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${esc(targetName)} - Security & Security review</title>
  <style>
    :root {
      --ground: #121410;
      --panel: #1a1c18;
      --bone: #e6e2d6;
      --mute: #8a877c;
      --rule: #2e312b;
      --brass: #9c7c45;
      --harm: #a33b32;
      --harm-text: #f08a80;
      --font-mono: "IBM Plex Mono", ui-monospace, SFMono-Regular, Menlo, monospace;
      --font-sans: "IBM Plex Sans", "Helvetica Neue", sans-serif;
    }

    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      background-color: var(--ground);
      color: var(--bone);
      font-family: var(--font-sans);
      font-size: 15.5px;
      line-height: 1.55;
      padding: 0 0 80px 0;
    }

    .container {
      max-width: 1200px;
      margin: 0 auto;
      padding: 0 24px;
    }

    /* Header */
    header {
      border-bottom: 1px solid var(--rule);
      padding: 40px 0 28px 0;
      margin-bottom: 28px;
    }
    .header-badge {
      font-family: var(--font-mono);
      font-size: 11px;
      font-weight: 500;
      letter-spacing: 0.16em;
      text-transform: uppercase;
      color: var(--brass);
      margin-bottom: 12px;
    }
    h1 {
      font-size: 30px;
      font-weight: 500;
      letter-spacing: -0.015em;
      line-height: 1.15;
      margin-bottom: 10px;
    }
    .header-sub {
      color: var(--mute);
      font-size: 15.5px;
      max-width: 66ch;
    }
    .header-sub code {
      background: none;
      padding: 0;
      color: var(--bone);
      font-size: 12.5px;
    }
    .header-nav {
      margin-top: 16px;
      font-family: var(--font-mono);
      font-size: 12px;
      letter-spacing: 0.08em;
      text-transform: uppercase;
    }
    .header-nav a {
      color: var(--brass);
      text-decoration: none;
      border-bottom: 1px solid var(--brass);
    }
    .header-nav a:hover { color: var(--bone); }

    /* Stat Cards */
    .stats-grid {
      display: grid;
      grid-template-columns: repeat(4, 1fr);
      margin-bottom: 28px;
      background: var(--panel);
      border: 1px solid var(--rule);
    }
    .stat-card {
      padding: 16px 18px 14px;
      display: flex;
      flex-direction: column;
    }
    .stat-card + .stat-card { border-left: 1px solid var(--rule); }
    .stat-num {
      font-family: var(--font-mono);
      font-size: 26px;
      font-weight: 500;
      line-height: 1;
      font-variant-numeric: tabular-nums;
      margin-bottom: 8px;
    }
    .stat-label {
      font-size: 11px;
      color: var(--mute);
      text-transform: uppercase;
      letter-spacing: 0.12em;
      font-weight: 500;
    }
    .stat-high { color: var(--harm-text); }

    /* Infographics & Charts Section */
    .visuals-section { margin-bottom: 32px; }
    .section-title {
      font-size: 18px;
      font-weight: 500;
      margin-bottom: 8px;
      padding-bottom: 6px;
      border-bottom: 1px solid var(--brass);
      display: inline-block;
    }
    .note { color: var(--mute); font-size: 14.5px; max-width: 68ch; margin: 8px 0 14px; }
    .svg-container {
      width: 100%;
      overflow: hidden;
      border: 1px solid var(--rule);
      background: var(--ground);
      margin-top: 12px;
      margin-bottom: 24px;
    }
    .svg-container svg {
      width: 100%;
      height: auto;
      display: block;
    }

    /* One row per surface. The severity numbers are the content; a zero stays mute. */
    .surface-list {
      margin-top: 16px;
      background: var(--panel);
      border: 1px solid var(--rule);
    }
    .surface-row {
      display: grid;
      grid-template-columns: 3.4rem minmax(12rem, 1fr) auto;
      gap: 8px 20px;
      align-items: center;
      padding: 14px 18px 14px 15px;
      border-left: 3px solid var(--rule);
    }
    .surface-row + .surface-row { border-top: 1px solid var(--rule); }
    .surface-row.tone-high { border-left-color: var(--harm); }
    .surface-row.tone-medium { border-left-color: var(--brass); }
    .surface-row.tone-low { border-left-color: var(--bone); }
    .surface-row.tone-info { border-left-color: var(--mute); }
    .surface-id {
      font-family: var(--font-mono);
      font-size: 13px;
      font-weight: 500;
      letter-spacing: 0.12em;
      color: var(--bone);
    }
    .surface-name {
      font-size: 15px;
      font-weight: 500;
      line-height: 1.3;
      color: var(--bone);
    }
    .threats { display: flex; gap: 18px; }
    .threat {
      display: flex;
      flex-direction: column;
      align-items: flex-end;
      min-width: 4.6rem;
    }
    .threat .n {
      font-family: var(--font-mono);
      font-size: 22px;
      font-weight: 500;
      line-height: 1;
      font-variant-numeric: tabular-nums;
    }
    .threat .k {
      margin-top: 4px;
      font-family: var(--font-mono);
      font-size: 10px;
      font-weight: 500;
      letter-spacing: 0.14em;
      text-transform: uppercase;
    }
    .t-high .n, .t-high .k { color: var(--harm-text); }
    .t-medium .n, .t-medium .k { color: var(--brass); }
    .t-low .n, .t-low .k { color: var(--bone); }
    .t-info .n, .t-info .k { color: var(--mute); }
    .threat.is-zero .n, .threat.is-zero .k { color: var(--mute); }

    /* Controls & Filters */
    .filter-bar {
      border-top: 1px solid var(--rule);
      border-bottom: 1px solid var(--rule);
      padding: 12px 0;
      margin-bottom: 16px;
      display: flex;
      flex-wrap: wrap;
      gap: 12px;
      align-items: center;
      justify-content: space-between;
    }
    .filter-group {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      align-items: center;
    }
    .filter-label {
      font-family: var(--font-mono);
      font-size: 11px;
      letter-spacing: 0.12em;
      text-transform: uppercase;
      color: var(--mute);
      margin-right: 4px;
    }
    .filter-btn {
      background: transparent;
      color: var(--mute);
      border: 1px solid var(--rule);
      padding: 5px 10px;
      font-family: var(--font-mono);
      font-size: 11px;
      letter-spacing: 0.06em;
      cursor: pointer;
    }
    .filter-btn:hover { color: var(--bone); border-color: var(--mute); }
    .filter-btn.active {
      color: var(--bone);
      border-color: var(--brass);
    }
    .search-input {
      background: var(--ground);
      border: 1px solid var(--rule);
      color: var(--bone);
      padding: 6px 10px;
      font-family: var(--font-sans);
      font-size: 14px;
      width: 260px;
      outline: none;
    }
    .search-input:focus { border-color: var(--brass); }

    /* Finding Cards */
    .finding-card {
      background: var(--panel);
      border: 1px solid var(--rule);
      margin-bottom: 10px;
      overflow: hidden;
    }
    .finding-header {
      padding: 16px 18px;
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 16px;
      cursor: pointer;
      user-select: none;
    }
    .finding-header:hover { background: #20241e; }
    .finding-card.open .finding-header { border-bottom: 1px solid var(--rule); }
    .finding-title-row {
      display: flex;
      flex-direction: column;
      gap: 6px;
    }
    .finding-title {
      font-size: 17px;
      font-weight: 500;
      color: var(--bone);
      margin-top: 8px;
    }
    .badge-row {
      display: flex;
      flex-wrap: wrap;
      gap: 14px;
      align-items: baseline;
    }
    .badge {
      font-family: var(--font-mono);
      font-size: 11px;
      font-weight: 500;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      color: var(--mute);
    }
    .badge-high, .badge-critical, .badge-refuted { color: var(--harm-text); }
    .badge-upheld { color: var(--brass); }
    .badge-partial { color: var(--bone); }
    .score-badge {
      font-size: 12px;
      font-weight: 500;
      font-family: var(--font-mono);
      color: var(--bone);
      font-variant-numeric: tabular-nums;
      min-width: 3ch;
      text-align: right;
    }

    .finding-body {
      padding: 16px 18px 8px;
      display: none;
      font-size: 15px;
      color: var(--bone);
    }
    .finding-card.open .finding-body {
      display: block;
    }

    .finding-section {
      margin-bottom: 16px;
    }
    .finding-section-title {
      font-family: var(--font-mono);
      font-size: 11px;
      font-weight: 500;
      text-transform: uppercase;
      letter-spacing: 0.1em;
      color: var(--mute);
      margin-bottom: 6px;
    }
    .harm-box, .fix-box {
      border-left: 2px solid var(--harm);
      padding: 2px 0 2px 12px;
      color: var(--bone);
      font-size: 15px;
      max-width: 68ch;
    }
    .fix-box { border-left-color: var(--brass); }
    .attack-list { padding-left: 18px; color: var(--mute); font-size: 14.5px; }
    pre {
      background: var(--ground);
      border: 1px solid var(--rule);
      padding: 12px 14px;
      font-family: var(--font-mono);
      font-size: 12px;
      color: var(--bone);
      overflow-x: auto;
      margin-top: 6px;
    }
    code {
      font-family: var(--font-mono);
      font-size: 12.5px;
      color: var(--bone);
    }

    /* Verified Safe Table */
    .safe-table {
      width: 100%;
      border-collapse: collapse;
      font-size: 14.5px;
      margin-top: 8px;
    }
    .safe-table th {
      text-align: left;
      padding: 8px 12px 8px 0;
      color: var(--mute);
      font-family: var(--font-mono);
      font-size: 11px;
      font-weight: 500;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      border-bottom: 1px solid var(--brass);
    }
    .safe-table td {
      padding: 10px 12px 10px 0;
      border-bottom: 1px solid var(--rule);
      vertical-align: top;
    }
    .verdict { font-family: var(--font-mono); font-size: 11px; letter-spacing: 0.1em; text-transform: uppercase; color: var(--brass); }
    .verdict.broke { color: var(--harm-text); }
    @media (max-width: 720px) {
      .stats-grid { grid-template-columns: repeat(2, 1fr); }
      .stat-card + .stat-card { border-left: 0; border-top: 1px solid var(--rule); }
      .surface-row { grid-template-columns: 3.4rem 1fr; }
      .threats { grid-column: 1 / -1; }
    }
  </style>
</head>
<body>

  <header>
    <div class="container">
      <div class="header-badge">Model Security Review · ${esc(dateLabel)}</div>
      <h1>${esc(targetName)} Security Audit</h1>
      <p class="header-sub">
        Adversarial multi-agent audit${meta.surface && meta.surface !== 'all' ? ` of surface ${esc(String(meta.surface).toUpperCase())}` : ''}${reviewers ? ` by ${esc(reviewers)}` : ''}.
        ${sourceLine ? `<br><code>${esc(sourceLine)}</code>` : ''}
      </p>
      <p class="header-nav"><a href="findings-by-model.html">Findings by model</a></p>
    </div>
  </header>

  <div class="container">

    <!-- Top Scorecards -->
    ${validationBanner}
    ${isolationBanner}
    <div class="stats-grid">
      <div class="stat-card">
        <div class="stat-num stat-high">${counts.high}</div>
        <div class="stat-label">High Severity Model Claims</div>
      </div>
      <div class="stat-card">
        <div class="stat-num stat-medium">${counts.medium}</div>
        <div class="stat-label">Medium Severity</div>
      </div>
      <div class="stat-card">
        <div class="stat-num stat-low">${counts.low + counts.info}</div>
        <div class="stat-label">Low & Informational</div>
      </div>
      <div class="stat-card">
        <div class="stat-num stat-quorum">${counts.modelAgreement}</div>
        <div class="stat-label">Model Agreement (Unverified)</div>
      </div>
    </div>
    <p class="note">Agreement means multiple asserted CLI adapters reported matching titles and citations. First-pass independence and served-provider identity are not enforced. Upheld, partial, and refuted are later model statements, not reproduction evidence. Scores are heuristic priorities, not probabilities.</p>

    ${sandboxBannerHtml}

    <!-- Visual Architecture & Infographics -->
    <div class="visuals-section">
      <div class="section-title">
        <span>Surfaces</span>
      </div>
      <p class="note">Each row is one surface. A colored number is how many findings sit at that severity. A mute zero means none.</p>

      <div class="surface-list">
        ${(() => {
          const showInfo = Object.values(surfaces).some((s) => s.info);
          const levels = showInfo ? ['high', 'medium', 'low', 'info'] : ['high', 'medium', 'low'];
          const labelFor = { high: 'High', medium: 'Medium', low: 'Low', info: 'Info' };
          return Object.entries(SURFACE_NAMES).map(([id, label]) => {
            const s = surfaces[id];
            const cells = levels.map((k) => {
              const n = s[k];
              return `<div class="threat t-${k}${n ? '' : ' is-zero'}"><span class="n">${n}</span><span class="k">${labelFor[k]}</span></div>`;
            }).join('');
            return `<div class="surface-row tone-${s.tone}">
            <div class="surface-id">${id}</div>
            <div class="surface-name">${esc(label)}</div>
            <div class="threats">${cells}</div>
          </div>`;
          }).join('');
        })()}
      </div>
    </div>

    ${sandboxMd ? `
    <div class="visuals-section">
      <div class="section-title"><span>Sandbox</span></div>
      <pre style="white-space: pre-wrap;">${esc(sandboxMd)}</pre>
    </div>` : ''}

    ${diagrams.length ? `
    <!-- Optional diagrams from <report-dir>/assets/*.svg -->
    <div class="visuals-section">
      <div class="section-title">
        <span>Diagrams</span>
      </div>
      ${diagrams.map((d) => `
      <h3 class="finding-section-title" style="margin-top: 16px;">${esc(d.title)}</h3>
      <pre class="svg-container">${esc(d.svg)}</pre>`).join('')}
    </div>` : ''}

    <!-- Filter & Search Controls -->
    <div class="filter-bar">
      <div class="filter-group">
        <span class="filter-label">Severity</span>
        <button class="filter-btn active" data-filter="all">ALL (${counts.total})</button>
        <button class="filter-btn" data-filter="high">HIGH+ (${counts.high})</button>
        <button class="filter-btn" data-filter="medium">MEDIUM (${counts.medium})</button>
        <button class="filter-btn" data-filter="low">LOW (${counts.low + counts.info})</button>
      </div>

      <input type="text" class="search-input" id="search-box" placeholder="Search findings, files, or fixes...">
    </div>

    <!-- Finding Cards List -->
    <div id="findings-container">
      ${findings.map((f, idx) => `
        <div class="finding-card ${idx === 0 ? 'open' : ''}" data-severity="${f.severity === 'critical' ? 'high' : esc(f.severity)}" data-surface="${esc(f.surface)}" data-title="${esc(String(f.title).toLowerCase())}">
          <div class="finding-header">
            <div class="finding-title-row">
              <div class="badge-row">
                <span class="badge badge-${f.severity === 'critical' ? 'high' : esc(f.severity)}">${esc(f.severity)}</span>
                <span class="badge badge-surface">${esc(f.surface)}</span>
                <span class="badge badge-${String(f.status).includes('REFUTED') ? 'refuted' : (String(f.status).includes('UPHELD') || f.status === 'MODEL_AGREEMENT') ? 'upheld' : String(f.status).includes('PARTIAL') ? 'partial' : 'quorum'}">${esc(f.status.replace(/_/g, ' '))}</span>
                <span class="badge">${esc(f.vendors.join(', '))}</span>
              </div>
              <div class="finding-title">${esc(f.title)}</div>
            </div>
            <div class="score-badge">${esc(f.score)}</div>
          </div>

          <div class="finding-body">
            ${Array.isArray(f.reviews) && f.reviews.length ? `
            <div class="finding-section">
              <div class="finding-section-title">Cross-check</div>
              ${f.reviews.map((r) => `<p class="note"><span class="badge badge-${r.verdict === 'refuted' ? 'refuted' : r.verdict === 'upheld' ? 'upheld' : 'partial'}">${esc(r.reviewer)} · ${esc(r.verdict)}</span> ${esc(r.reason)}</p>`).join('')}
            </div>` : ''}
            <div class="finding-section">
              <div class="finding-section-title">Harm & Blast Radius</div>
              <div class="harm-box">
                ${esc(f.findings?.[0]?.impact || 'No impact statement was provided by the auditor.')}
              </div>
            </div>

            <div class="finding-section">
              <div class="finding-section-title">Source Analysis & Impact</div>
              <p style="margin-bottom: 8px;">${f.findings?.[0]?.preconditions ? `<strong>Preconditions:</strong> ${esc(f.findings[0].preconditions)}` : ''}</p>
              ${f.findings?.[0]?.analysis ? `<p>${esc(f.findings[0].analysis)}</p>` : ''}
              ${f.findings?.[0]?.validation ? `<p><strong>Validation and limits:</strong> ${esc(f.findings[0].validation)}</p>` : ''}
              ${Array.isArray(f.findings?.[0]?.attack) ? `
                <ul class="attack-list">
                  ${f.findings[0].attack.map(step => `<li>${esc(step)}</li>`).join('')}
                </ul>
              ` : ''}
            </div>

            ${f.remediation ? `
              <div class="finding-section">
                <div class="finding-section-title">Remediation Patch / Fix Proposal</div>
                <div class="fix-box">
                  ${esc(f.remediation)}
                </div>
              </div>
            ` : ''}

            ${f.locations && f.locations.length > 0 ? `
              <div class="finding-section">
                <div class="finding-section-title">Affected Locations</div>
                <pre>${esc(f.locations.join('\n'))}</pre>
              </div>
            ` : ''}

            ${f.pocs && f.pocs.length > 0 ? `
              <div class="finding-section">
                <div class="finding-section-title">Proposed / Unexecuted Regression Material</div>
                <pre>${esc(f.pocs.join('\n'))}</pre>
              </div>
            ` : ''}
          </div>
        </div>
      `).join('')}
    </div>

    ${verifiedSafe.length ? `
    <!-- Verified Safe Section: what the auditors attacked and found holding -->
    <div class="visuals-section" style="margin-top: 40px;">
      <div class="section-title">
        <span>Auditor control assertions</span>
      </div>
      <p class="note">
        Unverified model assertions. No automatic contradiction detection or tiebreak escalation is implemented.
      </p>
      <table class="safe-table">
        <thead>
          <tr>
            <th>Security Invariant / Control</th>
            <th>Review Evidence</th>
            <th>Auditor</th>
            <th>Verdict</th>
          </tr>
        </thead>
        <tbody>
          ${verifiedSafe.map((s) => `
          <tr>
            <td><strong>${esc(s.control)}</strong></td>
            <td>${esc(s.how_attacked)}</td>
            <td>${esc(s.auditor)}</td>
            <td class="verdict${s.holds === false ? ' broke' : ''}">${s.holds === false ? 'Reported broken' : 'Reported holding (unverified)'}</td>
          </tr>`).join('')}
        </tbody>
      </table>
    </div>` : ''}

  </div>

  <script nonce="${nonce}">
    // Real-time filtering and search
    const buttons = document.querySelectorAll('.filter-btn');
    const searchBox = document.getElementById('search-box');
    const cards = document.querySelectorAll('.finding-card');
    document.querySelectorAll('.finding-header').forEach(header => {
      header.addEventListener('click', () => header.parentElement.classList.toggle('open'));
    });

    let currentSeverity = 'all';

    buttons.forEach(btn => {
      btn.addEventListener('click', () => {
        buttons.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        currentSeverity = btn.getAttribute('data-filter');
        filterCards();
      });
    });

    searchBox.addEventListener('input', () => {
      filterCards();
    });

    function filterCards() {
      const q = searchBox.value.toLowerCase();
      cards.forEach(card => {
        const sev = card.getAttribute('data-severity');
        const title = card.getAttribute('data-title');
        const matchSev = currentSeverity === 'all' || sev === currentSeverity;
        const matchSearch = !q || title.includes(q) || card.textContent.toLowerCase().includes(q);

        if (matchSev && matchSearch) {
          card.style.display = 'block';
        } else {
          card.style.display = 'none';
        }
      });
    }
  </script>
</body>
</html>
`;

const outputHtmlPath = path.join(reportDir, 'report.html');
const modelHtmlPath = path.join(reportDir, 'findings-by-model.html');
writeReportFile(reportDir, 'report.html', html);
writeReportFile(reportDir, 'findings-by-model.html', modelHtml);

console.log(`\n======================================================`);
console.log(` Standalone HTML review written:`);
console.log(` ${outputHtmlPath}`);
console.log(` ${modelHtmlPath}`);
console.log(`======================================================\n`);
if (health.state === 'incomplete') process.exitCode = 2;
