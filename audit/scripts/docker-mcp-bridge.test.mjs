import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  callBridgeTool,
  handleRpcMessage,
  normalizeCitation,
  normalizeCrosscheckPayload,
  normalizeFindingsPayload,
  parseBridgeArgs,
  toolDefinitions,
} from './docker-mcp-bridge.mjs';
import {
  analyzeStackAndPlans,
  renderAttackPlansMarkdown,
  renderSurfaceSkillGuidance,
} from './audit-plans.mjs';
import { buildAuditorPrompt, buildCliInvocation, extractJsonFromOutput, runOrchestratedAudit, validateTerminalAgreement } from './docker-agent-orchestrator.mjs';
import { readReportJson, validateAuditor, validCrosscheckRow } from './report-contract.mjs';

test('normalizeCitation strips container prefixes and ensures file:line format', () => {
  assert.equal(normalizeCitation('/work/src/programs/escrow/src/lib.rs:42-48'), 'programs/escrow/src/lib.rs:42');
  assert.equal(normalizeCitation('./src/index.ts:10'), 'src/index.ts:10');
  assert.throws(() => normalizeCitation('Cargo.toml'));
  assert.throws(() => normalizeCitation('../escape.rs:1'));
  assert.throws(() => normalizeCitation('/etc/passwd:1'));
});

test('normalizeFindingsPayload produces contract-valid auditor payloads', () => {
  const { payload, findings, verifiedSafe } = normalizeFindingsPayload({
    findings: [
      {
        title: 'Missing authority check on escrow withdrawal',
        surface: 's1',
        severity: 'HIGH',
        confidence: 'confirmed',
        location: ['/work/src/programs/escrow/src/lib.rs:88-95'],
        impact: 'Any caller can drain the escrow vault.',
        preconditions: 'Escrow account initialized.',
        attack: ['Call withdraw with arbitrary signer'],
        poc: 'See poc_withdraw.rs',
        fix: 'Add has_one = authority constraint.',
      },
    ],
    verified_safe: [
      {
        control: 'PDA bump canonicalization',
        how_attacked: 'Checked seeds and bump constraints in Initialize context',
        holds: true,
      },
    ],
  }, 'claude-s1-auth', 'S1');

  assert.equal(findings.length, 1);
  assert.equal(verifiedSafe.length, 1);
  assert.equal(findings[0].surface, 'S1');
  assert.deepEqual(findings[0].location, ['programs/escrow/src/lib.rs:88']);
  assert.doesNotThrow(() => validateAuditor(payload, 'claude-s1-auth'));
});

test('normalizeCrosscheckPayload requires actual verdicts for every assigned claim', () => {
  const assigned = [
    { id: 'claude-s1-auth#0', title: 'Missing authority check', location: ['programs/escrow/src/lib.rs:88'] },
    { id: 'grok-s1-auth#0', title: 'Unchecked PDA seed', location: ['programs/escrow/src/lib.rs:120'] },
  ];
  const submitted = [
    {
      id: 'claude-s1-auth#0',
      verdict: 'upheld',
      severity: 'high',
      reason: 'Confirmed UncheckedAccount without owner check at line 88.',
      evidence: ['/work/src/programs/escrow/src/lib.rs:88'],
    },
  ];
  assert.throws(() => normalizeCrosscheckPayload(submitted, assigned), /every assigned claim/);
  submitted.push({ id: 'grok-s1-auth#0', verdict: 'partial', reason: 'PDA seed implication remains unresolved.', evidence: ['programs/escrow/src/lib.rs:120'] });
  const rows = normalizeCrosscheckPayload(submitted, assigned);

  assert.equal(rows.length, 2);
  assert.ok(rows.every(validCrosscheckRow));
  assert.equal(rows[0].verdict, 'upheld');
  assert.equal(rows[1].id, 'grok-s1-auth#0');
  assert.equal(rows[1].verdict, 'partial');
  assert.throws(() => normalizeCrosscheckPayload([submitted[0], submitted[0]], assigned), /duplicate/);
  assert.throws(() => normalizeCrosscheckPayload([{ ...submitted[0], reason: '' }, submitted[1]], assigned));
  assert.throws(() => normalizeCrosscheckPayload([{ ...submitted[0], evidence: [] }, submitted[1]], assigned));
  assert.throws(() => normalizeCrosscheckPayload([{ ...submitted[0], id: 'unknown#0' }, submitted[1]], assigned));
});

test('malformed audit output cannot be converted into an empty successful review', () => {
  for (const payload of [{}, [], { verdict: 'no issues' }, { findings: [] }, { verified_safe: [] }, [null, { verified_safe: [] }]]) {
    assert.throws(() => normalizeFindingsPayload(payload, 'claude-s1-auth', 'S1'));
  }
  assert.throws(() => normalizeFindingsPayload({ findings: [], verified_safe: [{ control: 'test', how_attacked: 'read', holds: 'yes' }] }, 'claude-s1-auth', 'S1'));
});

test('reviews have no deadline and only explicit finalization restricts inspection', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'audit-session-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const prompt = buildAuditorPrompt({ targetName: 'inert', auditorName: 'grok-s6-client', surface: { code: 'S6' }, reportDir: root });
  assert.match(prompt, /no runner time limit/);
  assert.doesNotMatch(prompt, /Time budget:|final 300|inspection tools then stop/);
  assert.match(prompt, /surface is absent, submit an empty findings array/);
  assert.match(prompt, /Do not search the host/);
  const ctx = { role: 'auditor', surface: 'S6', reportDir: root, auditor: 'grok-s6-client', deadlineMs: Date.now() - 1000 };
  const result = await handleRpcMessage(ctx, { id: 1, method: 'tools/call', params: { name: 'get_audit_context' } });
  assert.equal(result.result.isError, false, 'legacy deadline metadata cannot close inspection');
  const ping = await handleRpcMessage(ctx, { id: 2, method: 'ping' });
  assert.deepEqual(ping.result, {});
  ctx.finalizeOnly = true;
  const closed = await handleRpcMessage(ctx, { id: 4, method: 'tools/call', params: { name: 'get_audit_context' } });
  assert.equal(closed.result.isError, true, 'an explicit submission-only recovery retains its scope');
  const submitted = await handleRpcMessage(ctx, { id: 3, method: 'tools/call', params: { name: 'submit_audit_report', arguments: { findings: [], verified_safe: [], markdown_summary: '# Finalization fixture\nNo security review performed.' } } });
  assert.equal(submitted.result.isError, false);
});

test('MCP JSON-RPC handler supports initialize, tools/list, get_attack_plan, and submit tools', async (t) => {
  const reportDir = fs.mkdtempSync(path.join(os.tmpdir(), 'audit-mcp-test-'));
  t.after(() => fs.rmSync(reportDir, { recursive: true, force: true }));

  const ctx = {
    dockerBin: '/usr/bin/false',
    container: '',
    reportDir,
    role: 'auditor',
    auditor: 'claude-s1-auth',
    agent: 'claude',
    surface: 'S1',
  };

  const initRes = await handleRpcMessage(ctx, {
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: { protocolVersion: '2024-11-05' },
  });
  assert.equal(initRes.result.protocolVersion, '2024-11-05');
  assert.equal(initRes.result.serverInfo.name, 'audit-docker-bridge');

  const listRes = await handleRpcMessage(ctx, {
    jsonrpc: '2.0',
    id: 2,
    method: 'tools/list',
  });
  const names = listRes.result.tools.map((tool) => tool.name);
  assert.ok(names.includes('get_attack_plan'));
  assert.ok(names.includes('list_files'));
  assert.ok(names.includes('read_file'));
  assert.ok(names.includes('search_code'));
  assert.ok(names.includes('run_container_check'));
  assert.ok(names.includes('write_poc'));
  assert.ok(names.includes('submit_audit_report'));

  const planRes = await handleRpcMessage(ctx, {
    jsonrpc: '2.0',
    id: 3,
    method: 'tools/call',
    params: {
      name: 'get_attack_plan',
      arguments: { domain: 'api_dto_abuse' },
    },
  });
  assert.equal(planRes.result.isError, false);
  assert.match(planRes.result.content[0].text, /user already registered/i);

  const submitRes = await handleRpcMessage(ctx, {
    jsonrpc: '2.0',
    id: 4,
    method: 'tools/call',
    params: {
      name: 'submit_audit_report',
      arguments: {
        findings: [],
        verified_safe: [{ control: 'Signer check', how_attacked: 'Inspected handler', holds: true }],
        markdown_summary: '# Clean S1 audit\nNo issues found on S1.',
      },
    },
  });
  assert.equal(submitRes.result.isError, false);
  const saved = readReportJson(reportDir, 'auditors/claude-s1-auth.json');
  assert.doesNotThrow(() => validateAuditor(saved, 'claude-s1-auth'));
  assert.equal(fs.existsSync(path.join(reportDir, 'auditors/claude-s1-auth.md')), true);
});

test('analyzeStackAndPlans detects http, grpc, websockets, databases, crypto, scopes/roles, bots/economy, and api_dto_abuse', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'audit-stack-plans-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  fs.mkdirSync(path.join(root, 'src'), { recursive: true });
  fs.mkdirSync(path.join(root, 'proto'), { recursive: true });
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({
    name: 'prize-app',
    dependencies: {
      '@nestjs/common': '^10.0.0',
      '@grpc/grpc-js': '^1.9.0',
      'socket.io': '^4.7.0',
      '@prisma/client': '^5.0.0',
      '@solana/web3.js': '^1.90.0',
    },
  }));
  fs.writeFileSync(path.join(root, 'proto', 'ride.proto'), 'syntax = "proto3";\nservice RideGrpc {\n  rpc SubmitRide (RideReq) returns (RideRes);\n}\n');
  fs.writeFileSync(path.join(root, 'src', 'auth.controller.ts'), [
    "import { Controller, Post, Get, Body, Param, Req, UseGuards } from '@nestjs/common';",
    "@Controller('/api/auth')",
    'export class AuthController {',
    "  @Post('/register')",
    '  async register(@Body() body: any) {',
    '    const existing = await this.prisma.user.findUnique({ where: { email: body.email } });',
    "    if (existing) return { message: 'User already registered' };",
    '    return this.prisma.user.create({ data: body });',
    '  }',
    "  @Get('/ride/:rideId')",
    '  async getRide(@Param("rideId") rideId: string, @Req() req: any) {',
    '    const host = req.headers.host;',
    '    return this.prisma.ride.findUnique({ where: { id: rideId } });',
    '  }',
    '}',
  ].join('\n'));
  fs.writeFileSync(path.join(root, 'src', 'live.gateway.ts'), [
    '@WebSocketGateway({ cors: { origin: "*" } })',
    'export class LiveGateway {',
    '  @SubscribeMessage("join")',
    '  onJoin(socket: any, room: string) { socket.join(room); }',
    '}',
  ].join('\n'));
  fs.writeFileSync(path.join(root, 'src', 'payout.service.ts'), [
    'export class PayoutService {',
    '  verifyRide(telemetry: any, completeDist: number) {',
    '    const rng = Math.random();',
    '    const winnersRoot = nacl.sign.detached.verify(telemetry, sig, pubkey);',
    '    return { prizePool: 1000, winnersRoot, rng };',
    '  }',
    '}',
  ].join('\n'));

  const profile = analyzeStackAndPlans(root);
  const byId = Object.fromEntries(profile.domains.map((d) => [d.id, d]));
  for (const id of ['http', 'grpc', 'websockets', 'databases', 'crypto', 'scopes_roles', 'bots_economy', 'api_dto_abuse']) {
    assert.equal(byId[id]?.detected, true, `expected domain ${id} to be detected`);
  }
  assert.ok(byId.api_dto_abuse.leads.some((l) => l.hits.some((h) => /User already registered/.test(h.snippet))));
  assert.ok(byId.bots_economy.totalLeads > 0);
  assert.ok(byId.scopes_roles.totalLeads > 0);

  const md = renderAttackPlansMarkdown(profile, 'S1');
  assert.match(md, /Scopes, Roles & Access Control Misvalidation/);
  assert.match(md, /API Abuse, Response DTO Leakage & Enumeration Oracles/);
  assert.match(md, /User already registered/);
  assert.match(renderSurfaceSkillGuidance('S3'), /Bot\/Economy Integrity/);
});

test('buildCliInvocation configures isolated MCP bridge workspaces for claude, codex, grok, and agy', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'audit-cli-inv-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const binDir = path.join(root, 'bin');
  fs.mkdirSync(binDir);
  for (const name of ['claude', 'codex', 'grok', 'agy']) {
    fs.writeFileSync(path.join(binDir, name), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
  }
  const env = { ...process.env, PATH: `${binDir}${path.delimiter}${process.env.PATH}` };
  const bridgeArgs = ['--container', 'audit-sbx-test', '--report-dir', root, '--role', 'auditor', '--auditor', 'claude-s1-auth', '--agent', 'claude', '--surface', 'S1'];

  for (const agent of ['claude', 'codex', 'grok', 'agy']) {
    const workDir = fs.mkdtempSync(path.join(root, `work-${agent}-`));
    const inv = buildCliInvocation({
      agent,
      model: 'test-model',
      prompt: 'Audit prompt',
      workDir,
      bridgeArgs,
      env,
    });
    assert.equal(inv.cwd, workDir);
    assert.ok(fs.existsSync(path.join(workDir, '.claude', 'skills', 'security-audit', 'SKILL.md')));
    assert.ok(fs.existsSync(path.join(workDir, '.agents', 'skills', 'security-audit', 'SKILL.md')));
    if (agent === 'claude') {
      assert.ok(fs.existsSync(path.join(workDir, 'mcp.json')));
      assert.ok(inv.args.includes('--strict-mcp-config'));
      assert.equal(inv.args[inv.args.indexOf('--tools') + 1], '');
    } else if (agent === 'codex') {
      assert.ok(inv.args.includes('--ignore-rules'));
      assert.ok(inv.args.includes('--ignore-user-config'));
      assert.ok(inv.args.some((a) => a.startsWith('mcp_servers={audit_docker=')));
    } else if (agent === 'grok') {
      assert.ok(fs.existsSync(path.join(workDir, '.grok', 'config.toml')));
      assert.ok(inv.args.includes('--trust'), 'only the generated workspace is trusted, so its MCP server can start');
      assert.equal(inv.args[inv.args.indexOf('--tools') + 1], '');
    } else if (agent === 'agy') {
      assert.equal(inv.args[inv.args.indexOf('--output-format') + 1], 'stream-json');
      assert.equal(inv.args.at(-1), '--print=Audit prompt', 'AGY print takes a prompt value, never the next option');
      assert.ok(!inv.args.includes('--print'));
      assert.ok(!inv.args.includes('-p'));
      assert.ok(fs.existsSync(path.join(workDir, '.agents', 'plugins', 'audit-docker', 'plugin.json')));
      assert.ok(fs.existsSync(path.join(workDir, '.agents', 'plugins', 'audit-docker', 'mcp_config.json')));
      assert.ok(fs.existsSync(path.join(workDir, '.agents', 'plugins', 'audit-docker', 'hooks.json')));
      const hooks = JSON.parse(fs.readFileSync(path.join(workDir, '.agents', 'plugins', 'audit-docker', 'hooks.json'), 'utf8'));
      const hook = hooks['audit-docker'].PreToolUse[0];
      assert.ok(new RegExp(hook.matcher).test('run_command'));
      assert.ok(new RegExp(hook.matcher).test('browser_subagent'), 'all built-ins pass through the allowlist hook');
      const { spawnSync } = await import('node:child_process');
      const deny = spawnSync('sh', ['-c', hook.hooks[0].command], { encoding: 'utf8' });
      assert.equal(JSON.parse(deny.stdout).decision, 'deny');
    }
  }
});

test('extractJsonFromOutput extracts fenced and inline JSON payloads', () => {
  const sample = 'Here is my analysis:\n```json\n[{"verified_safe": []}]\n```\nDone.';
  assert.deepEqual(extractJsonFromOutput(sample), [{ verified_safe: [] }]);
  assert.deepEqual(extractJsonFromOutput('Prose before [{"id":"claude-s1-auth#0","verdict":"upheld"}] after'), [{ id: 'claude-s1-auth#0', verdict: 'upheld' }]);
  const frames = [{ type: 'assistant', message: 'Tool input is not a final report' }, { type: 'result', result: sample }];
  assert.deepEqual(extractJsonFromOutput(frames.map(row => JSON.stringify(row)).join('\n')), [{ verified_safe: [] }]);
  assert.equal(extractJsonFromOutput(JSON.stringify({ type: 'assistant', input: [{ verified_safe: [] }] })), null);
  assert.equal(extractJsonFromOutput(JSON.stringify({ type: 'result', is_error: true, result: sample })), null);
  assert.deepEqual(extractJsonFromOutput(JSON.stringify({ event: 'result', result: { status: 'SUCCESS', response: sample } })), [{ verified_safe: [] }]);
  assert.equal(extractJsonFromOutput(JSON.stringify({ event: 'step_update', step_update: { text_delta: sample } })), null);
  assert.equal(extractJsonFromOutput(JSON.stringify({ event: 'result', result: { status: 'ERROR', response: sample } })), null);
});

test('AGY report finalization refuses a different source snapshot before starting Docker', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'audit-finalization-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const target = path.join(root, 'source');
  fs.mkdirSync(target);
  fs.writeFileSync(path.join(target, 'sample.js'), 'export const inert = true;\n');
  await assert.rejects(runOrchestratedAudit({ target, out: path.join(root, 'out'), surface: 's3', agents: ['agy'], models: { agy: 'test' }, resume: { sourceDigest: 'wrong-source', conversationId: '35216cfc-0324-47d7-a5c4-a3e393c5c9dc' } }), /original source snapshot/);
});

test('end-to-end one-shot Docker container + MCP bridge orchestrates audit, crosscheck, adjudication, and container teardown', async (t) => {
  const { spawnSync } = await import('node:child_process');
  const { fileURLToPath } = await import('node:url');
  const scriptsDir = path.dirname(fileURLToPath(import.meta.url));
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'audit-e2e-docker-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  const targetDir = path.join(root, 'solana-target');
  fs.mkdirSync(path.join(targetDir, 'src'), { recursive: true });
  fs.writeFileSync(path.join(targetDir, 'Cargo.toml'), '[package]\nname = "escrow"\nversion = "0.1.0"\n[dependencies]\nanchor-lang = "0.30.1"\n');
  fs.writeFileSync(path.join(targetDir, 'src', 'lib.rs'), [
    'use anchor_lang::prelude::*;',
    '#[derive(Accounts)]',
    'pub struct Withdraw<\'info> {',
    '    pub vault: UncheckedAccount<\'info>,',
    '}',
  ].join('\n') + '\n');

  const binDir = path.join(root, 'bin');
  fs.mkdirSync(binDir);
  const shimScript = `#!${process.execPath}
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const cwd = process.cwd();
let cmd, args;
if (fs.existsSync(path.join(cwd, 'mcp.json'))) {
  const cfg = JSON.parse(fs.readFileSync(path.join(cwd, 'mcp.json'), 'utf8'));
  cmd = cfg.mcpServers.audit_docker.command;
  args = cfg.mcpServers.audit_docker.args;
} else if (fs.existsSync(path.join(cwd, '.grok', 'config.toml'))) {
  const toml = fs.readFileSync(path.join(cwd, '.grok', 'config.toml'), 'utf8');
  cmd = JSON.parse(toml.match(/command\\s*=\\s*(.+)/)[1]);
  args = JSON.parse(toml.match(/args\\s*=\\s*(\\[.+\\])/)[1]);
} else {
  process.exit(1);
}

const child = spawn(cmd, args, { stdio: ['pipe', 'pipe', 'inherit'] });
let seq = 1;
const pending = new Map();
let buf = '';
child.stdout.on('data', (chunk) => {
  buf += chunk.toString('utf8');
  let idx;
  while ((idx = buf.indexOf('\\n')) !== -1) {
    const line = buf.slice(0, idx).trim();
    buf = buf.slice(idx + 1);
    if (!line) continue;
    const msg = JSON.parse(line);
    if (pending.has(msg.id)) {
      pending.get(msg.id)(msg);
      pending.delete(msg.id);
    }
  }
});

function rpc(method, params = {}) {
  const id = seq++;
  return new Promise((resolve) => {
    pending.set(id, resolve);
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\\n');
  });
}

await rpc('initialize', { protocolVersion: '2024-11-05' });
const toolsRes = await rpc('tools/list');
const toolNames = toolsRes.result.tools.map((t) => t.name);

const listOut = await rpc('tools/call', { name: 'list_files', arguments: { path: '/work/src' } });
const searchOut = await rpc('tools/call', { name: 'search_code', arguments: { pattern: 'UncheckedAccount' } });
const readOut = await rpc('tools/call', { name: 'read_file', arguments: { path: 'src/lib.rs', start_line: 1, end_line: 10 } });
const checkOut = await rpc('tools/call', { name: 'run_container_check', arguments: { command: 'ls', args: ['-la', '/work/src'] } });

if (toolNames.includes('submit_audit_report')) {
  await rpc('tools/call', {
    name: 'write_poc',
    arguments: { filename: 'poc_vault.rs', content: '#[test]\\nfn exploit() {}\\n', run_rust_test: false },
  });
  await rpc('tools/call', {
    name: 'submit_audit_report',
    arguments: {
      findings: [
        {
          title: 'Unchecked vault account allows arbitrary account substitution',
          surface: 'S1',
          severity: 'high',
          confidence: 'confirmed',
          location: ['src/lib.rs:4'],
          impact: 'Attacker can pass an arbitrary vault account without owner or seed verification.',
          preconditions: 'Withdraw instruction is callable.',
          attack: ['Invoke Withdraw with attacker-controlled vault account'],
          poc: 'See poc_vault.rs',
          fix: 'Use Account<\\'info, Vault> with seeds and has_one constraints.',
        },
      ],
      verified_safe: [
        {
          control: 'Container read/search verification',
          how_attacked: 'Verified via MCP tools: ' + [listOut, searchOut, readOut, checkOut].every((r) => !r.result.isError),
          holds: true,
        },
      ],
      markdown_summary: '# S1 Audit Summary\\nConfirmed UncheckedAccount at src/lib.rs:4 inside the one-shot Docker container.',
    },
  });
} else if (toolNames.includes('submit_crosscheck_report')) {
  const ctxOut = await rpc('tools/call', { name: 'get_audit_context', arguments: {} });
  const text = ctxOut.result.content[0].text;
  const jsonStart = text.indexOf('[\\n');
  const claims = jsonStart !== -1 ? JSON.parse(text.slice(jsonStart)) : [];
  await rpc('tools/call', {
    name: 'submit_crosscheck_report',
    arguments: {
      verdicts: claims.map((c) => ({
        id: c.id,
        verdict: 'upheld',
        severity: 'high',
        reason: 'Verified UncheckedAccount at src/lib.rs:4 inside the container via read_file.',
        evidence: ['src/lib.rs:4'],
      })),
    },
  });
}

child.stdin.end();
process.exit(Number(process.env.AUDIT_FIXTURE_EXIT || 0));
`;

  for (const name of ['claude', 'grok']) {
    fs.writeFileSync(path.join(binDir, name), shimScript, { mode: 0o755 });
  }

  const outDir = path.join(root, 'report');
  const run = spawnSync('bash', [
    path.join(scriptsDir, 'orchestrate.sh'),
    '--target', targetDir,
    '--out', outDir,
    '--surface', 's1',
    '--agents', 'claude,grok',
  ], {
    encoding: 'utf8',
    timeout: 90_000,
    env: {
      ...process.env,
      SANDBOX_FAST: '1',
      PATH: `${binDir}${path.delimiter}${process.env.PATH}`,
    },
  });

  assert.equal(run.status, 0, `orchestrate failed:\nSTDOUT:\n${run.stdout}\nSTDERR:\n${run.stderr}`);
  const health = JSON.parse(fs.readFileSync(path.join(outDir, 'report-health.json'), 'utf8'));
  assert.equal(health.state, 'validated_outputs', JSON.stringify(health));
  assert.deepEqual(health.errors, []);

  const findings = JSON.parse(fs.readFileSync(path.join(outDir, 'findings-and-scores.json'), 'utf8'));
  assert.equal(findings.length, 1);
  assert.equal(findings[0].status, 'MODEL_AGREEMENT');
  assert.deepEqual(findings[0].locations, ['src/lib.rs:4']);

  assert.equal(fs.existsSync(path.join(outDir, 'harness', 'solana.md')), true);
  assert.match(fs.readFileSync(path.join(outDir, 'harness', 'solana.md'), 'utf8'), /src\/lib\.rs:4/);
  assert.equal(fs.existsSync(path.join(outDir, 'harness', 'attack-plans.md')), true);
  assert.equal(fs.existsSync(path.join(outDir, 'harness', 'stack-profile.json')), true);
  assert.match(fs.readFileSync(path.join(outDir, 'harness', 'attack-plans.md'), 'utf8'), /Cryptography, Web3 Signatures & On-Chain Custody/);
  assert.equal(fs.existsSync(path.join(outDir, 'pocs', 'claude-s1-auth', 'poc_vault.rs')), true);
  assert.match(fs.readFileSync(path.join(outDir, 'report.html'), 'utf8'), /OUTPUTS VALIDATED/);

  const failedOut = path.join(root, 'failed-report');
  const failed = spawnSync('bash', [path.join(scriptsDir, 'orchestrate.sh'), '--target', targetDir, '--out', failedOut, '--surface', 's1', '--agents', 'claude'], {
    encoding: 'utf8', timeout: 90_000,
    env: { ...process.env, SANDBOX_FAST: '1', AUDIT_FIXTURE_EXIT: '1', PATH: `${binDir}${path.delimiter}${process.env.PATH}` },
  });
  assert.equal(failed.status, 2, `A nonzero worker exit must not be replaced by a report-shaped success: ${failed.stderr}`);
  assert.equal(JSON.parse(fs.readFileSync(path.join(failedOut, 'meta.json'))).workerExits['claude-s1-auth'], 1);
  assert.equal(JSON.parse(fs.readFileSync(path.join(failedOut, 'workers.json'))).jobs[0].observedExitCode, 1);
  assert.equal(JSON.parse(fs.readFileSync(path.join(failedOut, 'report-health.json'))).state, 'incomplete');

  for (const output of [run.stdout, failed.stdout]) {
    const owned = output.match(/Container (audit-sbx-[\w-]+) is ready/);
    assert.ok(owned, 'Fixture must identify its owned container');
    const inspect = spawnSync('docker', ['inspect', owned[1]], { encoding: 'utf8' });
    assert.notEqual(inspect.status, 0, 'The owned container must be removed without affecting concurrent audits');
  }
});


test('JSON-string report submission preserves nested findings and controls', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'audit-json-submit-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const ctx = { role: 'auditor', surface: 'S3', auditor: 'agy-s3-logic', reportDir: root, container: '' };
  const report = { findings: [{ title: 'Static evidence fixture', surface: 'S3', severity: 'low', confidence: 'probable', location: ['src/rules.rs:12'], impact: 'Fixture impact', preconditions: 'Fixture only', attack: ['Inspect source'], poc: '', fix: 'Require authorization' }], verified_safe: [{ control: 'Fixture bound', how_attacked: 'Read source', holds: true }], markdown_summary: '# Fixture; no actual audit performed.' };
  const result = await callBridgeTool(ctx, 'submit_audit_report', { report_json: JSON.stringify(report) });
  assert.match(result, /1 findings, 1 verified_safe/);
  const saved = readReportJson(root, 'auditors/agy-s3-logic.json');
  assert.equal(saved[0].title, report.findings[0].title);
  assert.deepEqual(saved[1].verified_safe, report.verified_safe);
  const terminal = JSON.stringify({ event: 'result', result: { status: 'SUCCESS', response: '```json\n' + JSON.stringify(saved) + '\n```' } });
  assert.doesNotThrow(() => validateTerminalAgreement(terminal, saved, ctx.auditor, 'S3'));
  assert.throws(() => validateTerminalAgreement(terminal, [{ verified_safe: [] }], ctx.auditor, 'S3'), /conflicts/);
  for (const args of [{ report_json: '{}', findings: [] }, { report_json: '[2]' }, { report_json: '{' }, { report_json: JSON.stringify({ findings: [2], verified_safe: [] }) }]) {
    await assert.rejects(callBridgeTool(ctx, 'submit_audit_report', args));
  }
  assert.throws(() => validateTerminalAgreement('```json\n[{"location":"src/rules.rs:12"},{"verified_safe":[]}]\n```', saved, ctx.auditor, 'S3'));
});

test('JSON-string peer verdicts still require complete assignment coverage', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'audit-json-peer-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, 'crosscheck'));
  fs.writeFileSync(path.join(root, 'crosscheck/agy.json'), JSON.stringify([{ id: 'claim-1' }]));
  const ctx = { role: 'crosscheck', agent: 'agy', reportDir: root, container: '' };
  await assert.rejects(callBridgeTool(ctx, 'submit_crosscheck_report', { report_json: JSON.stringify({ verdicts: [] }) }), /every assigned claim/);
  await callBridgeTool(ctx, 'submit_crosscheck_report', { report_json: JSON.stringify({ verdicts: [{ id: 'claim-1', verdict: 'partial', reason: 'Static source only', evidence: ['src/rules.rs:12'] }] }) });
  assert.equal(readReportJson(root, 'auditors/crosscheck-agy.json')[0].id, 'claim-1');
});
