#!/usr/bin/env node
/**
 * docker-agent-orchestrator.mjs
 *
 * Host orchestrator that:
 * 1. Starts the one-shot Docker sandbox container (`sandbox.sh --hold-file ...`),
 *    running all build/test/scanner/harness checks inside Docker and then
 *    disconnecting network egress before holding the container open.
 * 2. Launches the local agentic CLIs (`claude`, `codex`, `grok`, `agy`) in isolated
 *    empty temp directories on the host connected to `docker-mcp-bridge.mjs`.
 * 3. Runs the surface audit pass and peer cross-check pass inside the container.
 * 4. Saves validated reports and PoCs to the report directory and guarantees
 *    that the one-shot Docker container, volumes, and networks are killed and removed.
 */

import crypto from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { fileURLToPath } from 'node:url';
import { renderAttackPlansMarkdown, renderSurfaceSkillGuidance } from './audit-plans.mjs';
import { loadAuditorFindings } from './crosscheck.mjs';
import {
  normalizeCrosscheckPayload,
  normalizeFindingsPayload,
  renderMarkdownFromFindings,
  resolveDockerBin,
} from './docker-mcp-bridge.mjs';
import { readReportJson, readReportText, validateAuditor, writeReportFile } from './report-contract.mjs';
import { createSnapshot, disposeSnapshot } from './worker-isolation.mjs';
import { classifyAuditFailure, runAgentProcess } from './audit-process.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const BRIDGE_SCRIPT = path.join(HERE, 'docker-mcp-bridge.mjs');
const SANDBOX_SCRIPT = path.join(HERE, 'sandbox.sh');
const SKILL_FILE = path.resolve(HERE, '..', 'skills', 'security-audit', 'SKILL.md');

const SURFACES = [
  { id: 's1', code: 'S1', slug: 'auth', name: 'Identity, Scopes & Access Control', focus: 'authentication (HTTP/gRPC/WebSockets/SIWS), session/cookie flags, horizontal IDOR & scope misvalidation, vertical role/admin plane bypass, CSRF/CSWSH, login/register response DTO enumeration oracles, Solana signer/owner/authority checks' },
  { id: 's2', code: 'S2', slug: 'input', name: 'Input Handling, Protocols & Injection', focus: 'HTTP/gRPC/WebSocket input validation, protobuf zero-value traps & stream floods, SQL/NoSQL/Redis/command injection, deserialization, SSRF, path traversal, batch/rate abuse, Solana instruction data & account cosplay' },
  { id: 's3', code: 'S3', slug: 'logic', name: 'Business Logic, Bot/Economy Integrity & Custody', focus: 'headless bot & automation attacks on paid prize pools/games, telemetry forgery, replay copying across players, seed lookahead, sybil promo/free-ride farming, DB transaction races & missing FOR UPDATE row locks, Solana/Anchor escrow & Merkle proof invariants' },
  { id: 's4', code: 'S4', slug: 'config', name: 'Secrets, Config, Infra & Response DTO Leakage', focus: 'over-broad response DTOs leaking internal fields/seeds/hashes, error/status enumeration oracles, hard-coded secrets, key custody, Docker/CI/nginx/TLS hardening, gRPC reflection exposure' },
  { id: 's5', code: 'S5', slug: 'deps', name: 'Dependencies, Lockfiles & Supply Chain', focus: 'manifests and lockfiles, vulnerable crates/packages, install/postinstall scripts, unpinned CI actions, vendored code, verifiable Solana builds' },
  { id: 's6', code: 'S6', slug: 'client', name: 'Client, Web Surface, Realtime & Wallet Flows', focus: 'DOM XSS sinks, postMessage/origin checks, CSP/SRI, CORS, WebSocket room/stream IDOR, Solana Actions/Blinks, wallet signing flows, client-side trust boundaries & exposed DTO fields' },
];

export function resolveExecutable(name, env = process.env) {
  for (const dir of (env.PATH || '').split(path.delimiter)) {
    if (!dir) continue;
    const candidate = path.join(dir, name);
    try {
      fs.accessSync(candidate, fs.constants.X_OK);
      const real = fs.realpathSync(candidate);
      if (fs.statSync(real).isFile()) return real;
    } catch { /* continue */ }
  }
  return null;
}

export function checkBridgeAgents(env = process.env) {
  const dockerBin = resolveDockerBin();
  const dockerInfo = spawnSync(dockerBin, ['info', '--format', '{{.ServerVersion}}'], { encoding: 'utf8', timeout: 8000 });
  const dockerReady = dockerInfo.status === 0;
  const agents = ['claude', 'codex', 'grok', 'agy'].map((agent) => {
    const exe = resolveExecutable(agent, env);
    if (!exe) return { agent, state: 'unavailable', executable: null, version: null, bridgeMode: 'docker_mcp_stdio' };
    const ver = spawnSync(exe, ['--version'], { encoding: 'utf8', timeout: 5000, env });
    const text = (ver.stdout || ver.stderr || '').trim().split('\n')[0] || '';
    return {
      agent,
      state: ver.status === 0 ? 'ready' : 'error',
      executable: exe,
      version: text,
      bridgeMode: 'docker_mcp_stdio',
    };
  });
  return {
    state: dockerReady && agents.every((a) => a.state === 'ready') ? 'ready' : 'degraded',
    scope: 'docker_and_cli_availability_only',
    note: 'Authentication, quotas, MCP attachment and inference were not tested.',
    docker: { ready: dockerReady, binary: dockerBin, version: (dockerInfo.stdout || '').trim() || null },
    bridgeScript: BRIDGE_SCRIPT,
    agents,
  };
}

export function extractJsonFromOutput(text) {
  let s = String(text || '');
  // Print-mode JSONL contains tool inputs too; only decode the terminal model response.
  let framed = false;
  let finalText = null;
  for (const line of s.trim().split('\n').reverse()) {
    try {
      const frame = JSON.parse(line);
      if (['system', 'assistant', 'user', 'result'].includes(frame?.type)) framed = true;
      if (['init', 'step_update', 'result'].includes(frame?.event)) framed = true;
      if (frame?.event === 'result') {
        if (frame.result?.status !== 'SUCCESS' || typeof frame.result.response !== 'string') return null;
        finalText = frame.result.response;
        break;
      }
      if (frame?.type === 'result') {
        if (frame.is_error === true || String(frame.subtype || '').startsWith('error')) return null;
        if (typeof frame.result === 'string') finalText = frame.result;
        break;
      }
    } catch { /* plain-text CLI output */ }
  }
  if (framed && finalText === null) return null;
  if (finalText !== null) s = finalText;
  const fences = [...s.matchAll(/```(?:json)?\s*([\s\S]*?)```/gi)];
  for (let i = fences.length - 1; i >= 0; i--) {
    try { return JSON.parse(fences[i][1].trim()); } catch { /* try earlier fence */ }
  }
  for (let i = s.length - 1; i >= 0; i--) {
    const ch = s[i];
    if (ch !== ']' && ch !== '}') continue;
    const open = ch === ']' ? '[' : '{';
    for (let j = s.lastIndexOf(open, i); j >= 0; j = s.lastIndexOf(open, j - 1)) {
      const slice = s.slice(j, i + 1);
      if (slice.length < 2 || slice.length > 2 * 1024 * 1024) continue;
      try { return JSON.parse(slice); } catch { /* keep scanning */ }
    }
  }
  return null;
}

export function validateTerminalAgreement(output, submitted, auditor, surface) {
  const terminal = extractJsonFromOutput(output);
  if (terminal === null) return;
  const { payload } = normalizeFindingsPayload(terminal, auditor, surface);
  if (!isDeepStrictEqual(payload, submitted)) throw new Error('Terminal report conflicts with the submitted MCP report; review remains incomplete.');
}

const tomlStr = (val) => JSON.stringify(String(val));

function stageAuditSkill(workDir) {
  if (!fs.existsSync(SKILL_FILE)) return;
  const skillText = fs.readFileSync(SKILL_FILE, 'utf8');
  for (const rel of ['.claude/skills/security-audit', '.agents/skills/security-audit']) {
    const dir = path.join(workDir, rel);
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    fs.writeFileSync(path.join(dir, 'SKILL.md'), skillText, { mode: 0o600 });
  }
}

export function buildCliInvocation({ agent, model, prompt, workDir, bridgeArgs, conversationId, nodeBin = process.execPath, env = process.env }) {
  if (conversationId && (agent !== 'agy' || !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(conversationId))) throw new Error('Invalid AGY conversation identity');
  const exe = resolveExecutable(agent, env);
  if (!exe) throw new Error(`CLI executable not found on PATH: ${agent}`);
  const fullBridgeArgs = [BRIDGE_SCRIPT, ...bridgeArgs];
  stageAuditSkill(workDir);

  if (agent === 'claude') {
    const mcpFile = path.join(workDir, 'mcp.json');
    fs.writeFileSync(mcpFile, JSON.stringify({
      mcpServers: { audit_docker: { type: 'stdio', command: nodeBin, args: fullBridgeArgs } },
    }, null, 2), { mode: 0o600 });
    return {
      executable: exe,
      args: [
        '--print', '--strict-mcp-config', '--mcp-config', mcpFile, '--tools', '',
        '--permission-mode', 'dontAsk', '--allowedTools', 'mcp__audit_docker__*',
        '--no-session-persistence', '--disable-slash-commands', '--setting-sources', '',
        '--settings', '{"disableAllHooks":true,"autoMemoryEnabled":false}', '--model', model,
      ],
      stdin: prompt,
      cwd: workDir,
    };
  }

  if (agent === 'codex') {
    const argsToml = fullBridgeArgs.map(tomlStr).join(',');
    const mcpOverride = `mcp_servers={audit_docker={command=${tomlStr(nodeBin)},args=[${argsToml}],startup_timeout_sec=30,tool_timeout_sec=180}}`;
    return {
      executable: exe,
      args: [
        'exec', '--ephemeral', '--skip-git-repo-check', '--ignore-user-config', '--ignore-rules',
        '--color', 'never', '-s', 'read-only', '-C', workDir, '-c', mcpOverride,
        '-c', 'model_reasoning_effort="high"', '-m', model, '-',
      ],
      stdin: prompt,
      cwd: workDir,
    };
  }

  if (agent === 'grok') {
    const grokDir = path.join(workDir, '.grok');
    fs.mkdirSync(grokDir, { recursive: true, mode: 0o700 });
    const toml = `[mcp_servers.audit_docker]\ncommand = ${tomlStr(nodeBin)}\nargs = [${fullBridgeArgs.map(tomlStr).join(', ')}]\nenabled = true\n`;
    fs.writeFileSync(path.join(grokDir, 'config.toml'), toml, { mode: 0o600 });
    return {
      executable: exe,
      args: [
        '-p', prompt, '--cwd', workDir, '--trust', '--tools', '', '--always-approve',
        '--permission-mode', 'bypassPermissions', '--no-subagents', '--disable-web-search', '-m', model,
      ],
      stdin: '',
      cwd: workDir,
    };
  }

  if (agent === 'agy') {
    spawnSync('git', ['init', '-q'], { cwd: workDir, stdio: 'ignore' });
    const pluginDir = path.join(workDir, '.agents', 'plugins', 'audit-docker');
    fs.mkdirSync(pluginDir, { recursive: true, mode: 0o700 });
    fs.writeFileSync(path.join(pluginDir, 'plugin.json'), JSON.stringify({
      name: 'audit-docker',
      description: 'One-shot Docker container MCP bridge for security auditing',
    }, null, 2));
    fs.writeFileSync(path.join(pluginDir, 'mcp_config.json'), JSON.stringify({
      mcpServers: { audit_docker: { command: nodeBin, args: fullBridgeArgs } },
    }, null, 2));
    const shellQuote = value => `'${String(value).replaceAll("'", "'\\''")}'`;
    const skillFiles = ['.agents', '.claude'].flatMap(dir => {
      const file = path.join(workDir, dir, 'skills', 'security-audit', 'SKILL.md');
      return [file, fs.realpathSync(file)];
    });
    const denyCmd = [nodeBin, path.join(HERE, 'audit-tool-policy.mjs'), ...new Set(skillFiles)].map(shellQuote).join(' ');
    fs.writeFileSync(path.join(pluginDir, 'hooks.json'), JSON.stringify({
      'audit-docker': {
        PreToolUse: [{
          matcher: '.*',
          hooks: [{ type: 'command', command: denyCmd }],
        }],
      },
    }, null, 2));
    return {
      executable: exe,
      args: ['--output-format', 'stream-json', '--dangerously-skip-permissions', '--disable-slash-commands', '--model', model, ...(conversationId ? ['--conversation', conversationId] : []), `--print=${prompt}`],
      stdin: '',
      cwd: workDir,
    };
  }

  throw new Error(`Unsupported agent: ${agent}`);
}

function readHarnessContext(reportDir, surfaceCode) {
  const hDir = path.join(reportDir, 'harness');
  const read = (name, max = 3500) => {
    try { return fs.readFileSync(path.join(hDir, name), 'utf8').slice(0, max); } catch { return ''; }
  };
  const blocks = [renderSurfaceSkillGuidance(surfaceCode)];
  const summary = read('summary.md', 4000);
  if (summary) blocks.push('### Harness & Sandbox Summary\n' + summary);
  try {
    const profilePath = path.join(hDir, 'stack-profile.json');
    if (fs.existsSync(profilePath)) {
      const profile = JSON.parse(fs.readFileSync(profilePath, 'utf8'));
      blocks.push('### Tailored Stack & Domain Attack Plans\n' + renderAttackPlansMarkdown(profile, surfaceCode).slice(0, 7500));
    } else {
      const plans = read('attack-plans.md', 7500);
      if (plans) blocks.push('### Tailored Stack & Domain Attack Plans\n' + plans);
    }
  } catch { /* ignore */ }
  const solana = read('solana.md', 3000);
  if (solana && !solana.includes('Solana surface absent')) blocks.push('### Solana Leads\n' + solana);
  if (['S1', 'S2', 'S6'].includes(surfaceCode)) {
    const web = read('web.md', 2500);
    if (web && !web.includes('Web surface absent')) blocks.push('### Web Leads\n' + web);
  }
  if (surfaceCode === 'S4') {
    const cfg = read('config.md', 2500);
    if (cfg) blocks.push('### Config Leads\n' + cfg);
  }
  if (surfaceCode === 'S5') {
    const deps = read('deps.md', 2500);
    if (deps) blocks.push('### Dependency Leads\n' + deps);
  }
  return blocks.join('\n\n');
}

export function buildAuditorPrompt({ targetName, auditorName, surface, reportDir }) {
  return [
    `You are security auditor "${auditorName}" performing an adversarial security audit of "${targetName}" inside a one-shot Docker container using the \`security-audit\` skill.`,
    `Assigned Surface: ${surface.code} — ${surface.name}`,
    `Focus Areas: ${surface.focus}`,
    'There is no runner time limit. Take the time needed to inspect this surface and submit a supported report. Runner heartbeats keep the session observable during long reasoning; they are not requests to rush or finish.',
    '',
    'CRITICAL RULES:',
    '1. All target files and build/test tools live inside the one-shot Docker container at `/work/src` (and harness leads/attack plans at `/out/harness`).',
    '2. Use ONLY the `audit_docker` MCP tools (`get_audit_context`, `get_attack_plan`, `list_files`, `read_file`, `search_code`, `run_container_check`, `write_poc`, `submit_audit_report`) to inspect code, run checks inside the container, and submit your report.',
    '3. Follow the `security-audit` skill methodology: execute the detected protocol plans (`http`, `grpc`, `websockets`, `databases`, `crypto`) and mandatory cross-cutting checks (`scopes_roles` IDOR/RBAC misvalidation, `bots_economy` headless bot/prize-pool resistance, and `api_dto_abuse` response DTO leakage & enumeration oracles such as `"user already registered"`).',
    '4. Every finding MUST cite exact relative `file:line` locations (e.g. `programs/escrow/src/lib.rs:42`) verified by `read_file` or `search_code`.',
    `5. Every finding's "surface" field MUST be "${surface.code}". Severity: critical|high|medium|low|info. Confidence: confirmed|probable.`,
    '6. When finished, call `submit_audit_report` with `findings`, `verified_safe`, and `markdown_summary`. If this surface is absent, submit an empty findings array and explain the absent surface in the markdown; a report is still required.',
    'For CLIs with nested-argument serialization problems (especially AGY), call submit_audit_report with only report_json: a JSON-encoded string of that complete object. Each finding requires title, surface, severity, confidence, location (array of file:line strings), impact, preconditions, attack (array of steps), poc (string), and fix. Each control requires control, how_attacked, and holds (boolean). Do not submit empty arrays to bypass serialization errors. The final JSON must match the submitted report.',
    '7. Also output your final JSON array (`[...findings, { "verified_safe": [...] }]`) inside a ```json code block at the end of your response.',
    '8. If the audit_docker tools are unavailable, stop and explain the MCP connection failure. Do not search the host for tools, recreate a container, or substitute host commands.',
    '',
    readHarnessContext(reportDir, surface.code),
  ].filter(Boolean).join('\n');
}

function buildCrosscheckPrompt({ targetName, agent, claims }) {
  return [
    `You are peer security reviewer "${agent}" performing a cross-check of findings reported by other models on "${targetName}" inside the one-shot Docker container using the \`security-audit\` skill.`,
    'There is no runner time limit. Take the time needed to review every assigned claim; disclose coverage gaps and never invent missing verdicts.',
    '1. Use `audit_docker` MCP tools (`get_attack_plan`, `read_file`, `search_code`, `run_container_check`) to inspect the cited `file:line` locations under `/work/src`.',
    '2. Double-check scope/role guards, DB locks, bot/economy invariants, and API response DTOs (for example, if a claim states an API returns an enumeration oracle like "user already registered" or leaks fields, verify the exact DTO/error in source).',
    '3. For EVERY assigned claim ID below, decide a verdict: "upheld", "partial", or "refuted", with `reason` and relative `file:line` `evidence` citations.',
    '4. Call `submit_crosscheck_report` with `verdicts: [...]` covering every assigned claim ID, and also output the JSON array in a ```json code block.',
    'If nested object arrays fail to serialize, pass only report_json: a JSON-encoded string of the object containing verdicts. Never drop claims to work around argument errors.',
    '5. If the audit_docker tools are unavailable, stop and explain the connection failure. Do not use host commands or recreate containers.',
    '',
    'Assigned Claims:\n```json\n' + JSON.stringify(claims, null, 2) + '\n```',
  ].join('\n');
}

async function startOneShotDocker({ target, out, rpc }) {
  const holdDir = fs.mkdtempSync(path.join(os.tmpdir(), 'audit-hold-'));
  const holdFile = path.join(holdDir, 'hold.lock');
  const readyFile = path.join(holdDir, 'ready.json');
  fs.writeFileSync(holdFile, 'hold\n');
  const args = [SANDBOX_SCRIPT, '--target', target, '--out', out, '--hold-file', holdFile, '--ready-file', readyFile];
  if (rpc) args.push('--rpc', rpc);
  const child = spawn('bash', args, { stdio: ['ignore', 'inherit', 'inherit'], env: process.env });
  let closed = false;
  let exitCode = null;
  const closePromise = new Promise((resolve) => {
    child.on('close', (code) => { closed = true; exitCode = code ?? 1; resolve(exitCode); });
  });
  const deadline = Date.now() + Number(process.env.AUDIT_SANDBOX_BUDGET_MS || 45 * 60 * 1000);
  while (!closed && Date.now() < deadline) {
    if (fs.existsSync(readyFile)) {
      try {
        const info = JSON.parse(fs.readFileSync(readyFile, 'utf8'));
        if (info.container) {
          return {
            container: info.container,
            hostRunDir: info.hostRunDir,
            stop: async () => {
              try { fs.rmSync(holdFile, { force: true }); } catch {}
              await Promise.race([closePromise, new Promise((r) => setTimeout(r, 15_000))]);
              spawnSync(resolveDockerBin(), ['rm', '-f', info.container], { stdio: 'ignore' });
              try { fs.rmSync(holdDir, { recursive: true, force: true }); } catch {}
            },
          };
        }
      } catch { /* wait for write */ }
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  try { fs.rmSync(holdFile, { force: true }); } catch {}
  await closePromise;
  try { fs.rmSync(holdDir, { recursive: true, force: true }); } catch {}
  throw new Error(`One-shot Docker sandbox exited before becoming ready (exit ${exitCode})`);
}

export async function runOrchestratedAudit(request) {
  const output = path.resolve(request.out);
  if (output === fs.realpathSync(request.target)) throw new Error('output cannot be the source root');
  if (fs.existsSync(output) && fs.readdirSync(output).length) throw new Error('output directory must be empty');
  fs.mkdirSync(path.join(output, 'auditors'), { recursive: true, mode: 0o700 });
  fs.mkdirSync(path.join(output, 'harness'), { recursive: true, mode: 0o700 });
  fs.mkdirSync(path.join(output, 'pocs'), { recursive: true, mode: 0o700 });

  const snapshot = createSnapshot(request.target, { exclude: [output] });
  const sourceDigest = snapshot.manifest.digest;
  writeReportFile(output, 'source-manifest.json', `${JSON.stringify(snapshot.manifest, null, 2)}\n`);
  disposeSnapshot(snapshot);
  if (request.resume && (request.resume.sourceDigest !== sourceDigest || request.agents.length !== 1 || request.agents[0] !== 'agy' || request.surface === 'all' || !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(request.resume.conversationId || ''))) throw new Error('AGY finalization requires one surface, its original source snapshot and a valid conversation identity');

  const surfaceArg = String(request.surface || 'all').toLowerCase();
  const selectedSurfaces = surfaceArg === 'all' ? SURFACES : SURFACES.filter((s) => s.id === surfaceArg || s.slug === surfaceArg);
  if (!selectedSurfaces.length) throw new Error(`Unknown surface: ${request.surface}`);

  const jobs = selectedSurfaces.flatMap((s, idx) => {
    const agents = surfaceArg === 'all' ? [request.agents[idx % request.agents.length]] : request.agents;
    return agents.map((agent) => ({
      id: crypto.randomUUID(), name: `${agent}-${s.id}-${s.slug}`,
      adapter: agent, requestedModel: request.models[agent], surface: s, state: 'pending',
    }));
  });

  if (request.resume) {
    if (!/^[\w.-]+$/.test(request.resume.fromReport || '') || ['.', '..'].includes(request.resume.fromReport)) throw new Error('Invalid source review record');
    const prior = path.join(path.dirname(output), request.resume.fromReport);
    const meta = readReportJson(prior, 'meta.json');
    const manifest = readReportJson(prior, 'source-manifest.json');
    const init = JSON.parse(readReportText(prior, `harness/sandbox-run/agent-${jobs[0].name}.log`, 8 * 1024 * 1024).split('\n')[0]);
    if (manifest.digest !== sourceDigest || meta.models?.agy !== request.models.agy || init.conversation_id !== request.resume.conversationId || meta.workerExits?.[jobs[0].name] !== 124) throw new Error('Saved AGY review does not match the source, model, conversation or timed-out job');
    for (const file of ['sandbox.md', 'summary.md']) writeReportFile(output, `harness/${file}`, `${readReportText(prior, `harness/${file}`)}\nReport finalization only: coverage copied from ${request.resume.fromReport} for the same source digest; no new builds, tests or scanners ran.\n`);
  }

  const stageFailures = [];
  const workerExits = Object.fromEntries(jobs.map((j) => [j.name, null]));
  const crosscheckExits = {};
  const dockerBin = resolveDockerBin();
  const agentTimeoutMs = null;

  let session = null;
  const cancellation = new AbortController();
  const cleanupSignal = async () => { cancellation.abort(); if (session) await session.stop(); process.exit(130); };
  const processOptions = (name) => ({
    signal: cancellation.signal,
    onProgress: ({ elapsedMs, idleMs, pid }) => {
      console.log(`     [${name}] heartbeat: running ${Math.floor(elapsedMs / 1000)}s; last output ${Math.floor(idleMs / 1000)}s ago; no time limit.`);
      try { writeReportFile(output, `harness/heartbeat-${name}.json`, `${JSON.stringify({ state: 'running', at: new Date().toISOString(), elapsedMs, idleMs, pid, timeLimitMs: null })}\n`); }
      catch { console.error(`     [${name}] heartbeat record could not be saved; review continues.`); }
    },
  });
  process.on('SIGINT', cleanupSignal);
  process.on('SIGTERM', cleanupSignal);

  try {
    if (request.resume) {
      console.log('[1/4] Resuming report submission only; reusing recorded coverage, with inspection disabled.');
      const hostRunDir = path.join(output, 'harness', 'sandbox-run');
      fs.mkdirSync(hostRunDir, { recursive: true, mode: 0o700 });
      session = { container: '', hostRunDir, stop: async () => {} };
    } else {
      console.log('[1/4] Starting one-shot Docker sandbox & running in-container build/scanner/harness checks...');
      session = await startOneShotDocker({ target: request.target, out: output, rpc: request.rpc });
      console.log(`      Container ${session.container} is ready and airgapped (network disconnected).`);
    }

    console.log(`[2/4] Running ${jobs.length} surface audit job(s) across [${request.agents.join(', ')}] via MCP bridge...`);
    for (const job of jobs) {
      const workDir = fs.mkdtempSync(path.join(os.tmpdir(), `audit-agent-${job.name}-`));
      fs.chmodSync(workDir, 0o700);
      const logFile = path.join(output, 'harness', 'sandbox-run', `agent-${job.name}.log`);
      try {
        job.state = 'running';
        console.log(`  -> [${job.name}] (${job.adapter} @ ${job.requestedModel}) auditing ${job.surface.code} (${job.surface.name})...`);
        let prompt = buildAuditorPrompt({ targetName: request.name, auditorName: job.name, surface: job.surface, reportDir: output });
        if (request.resume) {
          job.resumedConversationId = request.resume.conversationId;
          job.phase = 'report_finalization';
          prompt += '\n\nREPORT FINALIZATION ONLY: Continue your saved source review of this exact snapshot. Do not investigate further or run more checks. The earlier review exhausted its time budget. Submit the findings and controls already supported by the code you inspected, with explicit not-tested and incomplete-coverage notes. Then finish. Do not invent missing findings, citations or coverage. The MCP bridge now allows report submission only.';
        }
        const bridgeArgs = ['--docker-bin', dockerBin, '--container', session.container, '--report-dir', output, '--role', 'auditor', '--auditor', job.name, '--agent', job.adapter, '--surface', job.surface.code];
        if (request.resume) bridgeArgs.push('--finalize-only');
        const invocation = buildCliInvocation({ agent: job.adapter, model: job.requestedModel, prompt, workDir, bridgeArgs, conversationId: request.resume?.conversationId });
        const res = await runAgentProcess(invocation, agentTimeoutMs, logFile, processOptions(job.name));
        writeReportFile(output, `harness/heartbeat-${job.name}.json`, `${JSON.stringify({ state: 'exited', at: new Date().toISOString(), elapsedMs: res.elapsedMs, exitCode: res.code, timeLimitMs: null })}\n`);
        job.observedExitCode = res.code;
        job.elapsedMs = res.elapsedMs;
        job.logFile = path.relative(output, logFile);
        if (res.code !== 0) {
          job.failure = classifyAuditFailure(res);
          throw new Error(job.failure.message);
        }
        const jsonPath = path.join(output, 'auditors', `${job.name}.json`);
        const mdPath = path.join(output, 'auditors', `${job.name}.md`);

        if (!fs.existsSync(jsonPath) || !fs.existsSync(mdPath)) {
          const extracted = extractJsonFromOutput(res.stdout);
          if (extracted) {
            const { payload, findings, verifiedSafe } = normalizeFindingsPayload(extracted, job.name, job.surface.code);
            writeReportFile(output, `auditors/${job.name}.json`, `${JSON.stringify(payload, null, 2)}\n`);
            writeReportFile(output, `auditors/${job.name}.md`, renderMarkdownFromFindings(job.name, job.surface.code, findings, verifiedSafe, res.stdout));
          }
        }
        if (fs.existsSync(jsonPath) && fs.existsSync(mdPath)) {
          const submitted = readReportJson(output, `auditors/${job.name}.json`);
          validateAuditor(submitted, job.name);
          try { validateTerminalAgreement(res.stdout, submitted, job.name, job.surface.code); }
          catch (err) { job.failure = classifyAuditFailure({ code: 0 }, 'invalid_report'); throw err; }
          workerExits[job.name] = 0;
          job.state = 'collected';
          console.log(`  <- [${job.name}] completed and validated.`);
        } else {
          workerExits[job.name] = 1;
          job.state = 'failed';
          job.failure = classifyAuditFailure(res);
          stageFailures.push(`auditor_failed:${job.name}`);
          console.error(`  <- [${job.name}] ${job.failure.message} See ${job.logFile}.`);
        }
      } catch (err) {
        workerExits[job.name] = job.observedExitCode || 1;
        job.state = 'failed';
        job.failure ||= classifyAuditFailure({ code: 0 }, job.observedExitCode == null ? 'setup_error' : 'invalid_report');
        stageFailures.push(`auditor_error:${job.name}`);
        console.error(`  <- [${job.name}] ${job.failure.message} See ${path.relative(output, logFile)}.`);
      } finally {
        fs.rmSync(workDir, { recursive: true, force: true });
      }
    }

    const baseMeta = {
      name: request.name || path.basename(request.target), mode: request.mode || 'local',
      source: request.source || request.target, ref: request.ref || null, commit: request.commit || null,
      date: new Date().toISOString(), surface: surfaceArg, agents: request.agents, models: request.models,
      auditors: jobs.map((j) => j.name), workerExits, crosscheckExits, stageFailures, finalized: true,
    };
    writeReportFile(output, 'meta.json', `${JSON.stringify(baseMeta, null, 2)}\n`);

    const allClaims = loadAuditorFindings(path.join(output, 'auditors'));
    fs.mkdirSync(path.join(output, 'crosscheck'), { recursive: true });
    const containerCrosscheckDir = path.join(session.hostRunDir, 'crosscheck');
    fs.mkdirSync(containerCrosscheckDir, { recursive: true });

    console.log('[3/4] Running peer cross-check pass via MCP bridge...');
    for (const agent of request.agents) {
      const peerClaims = allClaims.filter((c) => c.model && c.model !== agent);
      if (!peerClaims.length) continue;
      const claimsJson = `${JSON.stringify(peerClaims, null, 2)}\n`;
      writeReportFile(output, `crosscheck/${agent}.json`, claimsJson);
      fs.writeFileSync(path.join(containerCrosscheckDir, `${agent}.json`), claimsJson);

      const workDir = fs.mkdtempSync(path.join(os.tmpdir(), `audit-xcheck-${agent}-`));
      fs.chmodSync(workDir, 0o700);
      const logFile = path.join(output, 'harness', 'sandbox-run', `crosscheck-${agent}.log`);
      try {
        console.log(`  -> [crosscheck-${agent}] reviewing ${peerClaims.length} peer claim(s)...`);
        const prompt = buildCrosscheckPrompt({ targetName: request.name, agent, claims: peerClaims });
        const bridgeArgs = ['--docker-bin', dockerBin, '--container', session.container, '--report-dir', output, '--role', 'crosscheck', '--agent', agent];
        const invocation = buildCliInvocation({ agent, model: request.models[agent], prompt, workDir, bridgeArgs });
        const res = await runAgentProcess(invocation, agentTimeoutMs, logFile, processOptions(`crosscheck-${agent}`));
        writeReportFile(output, `harness/heartbeat-crosscheck-${agent}.json`, `${JSON.stringify({ state: 'exited', at: new Date().toISOString(), elapsedMs: res.elapsedMs, exitCode: res.code, timeLimitMs: null })}\n`);
        crosscheckExits[agent] = res.code || 1;
        if (res.code !== 0) throw new Error(classifyAuditFailure(res).message);
        const xPath = path.join(output, 'auditors', `crosscheck-${agent}.json`);
        if (!fs.existsSync(xPath)) {
          const extracted = extractJsonFromOutput(res.stdout);
          if (extracted) {
            writeReportFile(output, `auditors/crosscheck-${agent}.json`, `${JSON.stringify(normalizeCrosscheckPayload(extracted, peerClaims), null, 2)}\n`);
          }
        }
        if (fs.existsSync(xPath)) {
          const rows = readReportJson(output, `auditors/crosscheck-${agent}.json`);
          writeReportFile(output, `auditors/crosscheck-${agent}.json`, `${JSON.stringify(normalizeCrosscheckPayload(rows, peerClaims), null, 2)}\n`);
          crosscheckExits[agent] = 0;
          console.log(`  <- [crosscheck-${agent}] completed and validated.`);
        } else {
          crosscheckExits[agent] = res.code || 1;
          stageFailures.push(`crosscheck_failed:${agent}`);
          console.error(`  <- [crosscheck-${agent}] failed (exit ${res.code}).`);
        }
      } catch (err) {
        crosscheckExits[agent] ||= 1;
        stageFailures.push(`crosscheck_error:${agent}`);
        console.error(`  <- [crosscheck-${agent}] error: ${err.message}`);
      } finally {
        fs.rmSync(workDir, { recursive: true, force: true });
      }
    }
  } catch (err) {
    stageFailures.push(`sandbox_or_orchestrator:${err.message}`);
    console.error(`Orchestrator error: ${err.message}`);
  } finally {
    process.removeListener('SIGINT', cleanupSignal);
    process.removeListener('SIGTERM', cleanupSignal);
    if (session) {
      console.log(request.resume ? '[4/4] Closing report-finalization session...' : '[4/4] Stopping and removing one-shot Docker container and volumes...');
      await session.stop();
    }
  }

  writeReportFile(output, 'workers.json', `${JSON.stringify({ version: 1, runId: crypto.randomUUID(), policy: request.resume ? 'report_finalization' : 'docker_mcp_bridge', sourceDigest, jobs }, null, 2)}\n`);
  const finalMeta = {
    name: request.name || path.basename(request.target), mode: request.mode || 'local',
    source: request.source || request.target, ref: request.ref || null, commit: request.commit || null,
    date: new Date().toISOString(), surface: surfaceArg, agents: request.agents, models: request.models,
    auditors: jobs.map((j) => j.name), workerExits, crosscheckExits, stageFailures, finalized: true,
    ...(request.resume ? { recovery: { ...request.resume, phase: 'report_finalization' } } : {}),
    isolation: { policy: request.resume ? 'report_finalization' : 'docker_mcp_bridge', sourceDigest, liveTransport: request.resume ? 'report_submission_mcp_stdio' : 'docker_mcp_stdio', privateOutputs: 'validated', workerManifest: 'workers.json' },
  };
  writeReportFile(output, 'meta.json', `${JSON.stringify(finalMeta, null, 2)}\n`);
  return { stageFailures, output };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [arg1] = process.argv.slice(2);
  if (arg1 === '--check') {
    const status = checkBridgeAgents();
    console.log(JSON.stringify(status, null, 2));
    process.exit(status.state === 'ready' ? 0 : 2);
  }
  if (!arg1 || !fs.existsSync(arg1)) {
    console.error('usage: docker-agent-orchestrator.mjs <request.json> | --check');
    process.exit(2);
  }
  const request = JSON.parse(fs.readFileSync(arg1, 'utf8'));
  runOrchestratedAudit(request).then(
    ({ stageFailures }) => { if (stageFailures.length) process.exitCode = 2; },
    (err) => { console.error(err.message || err); process.exitCode = 2; },
  );
}
