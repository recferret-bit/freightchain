import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { runOrchestratedAudit } from './docker-agent-orchestrator.mjs';
import { commitSubmission } from './audit-submission.mjs';
import { readReportJson } from './report-contract.mjs';

// Inert reviewer gates expose scheduling without provider requests or target execution.
function fixture(t, agents = ['claude', 'grok', 'agy', 'codex'], surface = 'all') {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'audit-parallel-'));
  const target = path.join(root, 'source'), out = path.join(root, 'report');
  fs.mkdirSync(target);
  fs.writeFileSync(path.join(target, 'source.js'), 'export const inert = true;\n');
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const started = new Map(), active = new Set(), completed = [];
  let stopped = false;
  const review = async options => {
    const { identity } = options;
    assert.equal(stopped, false);
    assert.equal(active.has(identity.agent), false, 'one active session per provider');
    active.add(identity.agent);
    const result = await new Promise(resolve => started.set(identity.name, { ...options, release: resolve }));
    try {
      if (result?.throw) throw new Error('Inert reviewer transport failure');
      if (!result?.code && !result?.missingReport) {
        const payload = identity.role === 'auditor' ? [{
          title: `Inert finding ${identity.name}`, surface: identity.surface,
          severity: 'low', confidence: 'probable', location: ['source.js:1'],
          impact: 'Fixture only', preconditions: 'Inert fixture', analysis: 'Inspected source.js:1',
          validation: 'No target execution', attack: [], poc: '', fix: 'Fixture guidance',
        }, { verified_safe: [] }] : readReportJson(out, `crosscheck/${identity.agent}.json`).map(claim => ({
          id: claim.id, verdict: 'upheld', reason: 'Inert source evidence', evidence: ['source.js:1'],
        }));
        commitSubmission(out, identity.name, identity, payload);
      }
      return { code: 0, observedExitCode: 0, elapsedMs: 1, sessionId: identity.name, directory: options.directory, ...result };
    } finally { active.delete(identity.agent); completed.push(identity.name); }
  };
  const startSandbox = async () => ({ container: 'inert-sandbox', hostRunDir: path.join(root, 'container-output'), stop: async () => {
    assert.equal(active.size, 0, 'cleanup waits for every active session');
    stopped = true;
  } });
  const request = { target, out, name: 'inert-scheduling-fixture', agents, surface, models: Object.fromEntries(agents.map(agent => [agent, 'fixture-model'])) };
  const run = runOrchestratedAudit(request, { review, startSandbox });
  const waitFor = async predicate => {
    const deadline = performance.now() + 3000;
    while (!predicate()) {
      assert.ok(performance.now() < deadline, 'scheduler reached the expected state');
      await delay(5);
    }
  };
  return { out, started, active, completed, run, waitFor, get stopped() { return stopped; } };
}

test('providers overlap, their own surfaces queue, and peer reviews start together after all surfaces finish', { timeout: 10_000 }, async t => {
  const f = fixture(t);
  await f.waitFor(() => f.started.size === 4);
  assert.equal(f.active.size, 4);
  assert.deepEqual([...f.started.keys()], ['claude-s1-auth', 'grok-s2-input', 'agy-s3-logic', 'codex-s4-config']);
  const workers = readReportJson(f.out, 'workers.json');
  assert.equal(workers.jobs.filter(job => job.state === 'running').length, 4);
  assert.equal(workers.jobs.filter(job => job.state === 'pending').length, 2);

  f.started.get('grok-s2-input').release();
  await f.waitFor(() => f.started.has('grok-s6-client'));
  assert.equal(f.completed.includes('claude-s1-auth'), false, 'fast providers advance without waiting for slow peers');
  f.started.get('claude-s1-auth').release();
  await f.waitFor(() => f.started.has('claude-s5-deps'));
  for (const name of ['agy-s3-logic', 'codex-s4-config', 'claude-s5-deps']) f.started.get(name).release();
  await f.waitFor(() => f.completed.length === 5);
  assert.equal(f.started.size, 6, 'cross-checks wait for the last surface');
  assert.equal(f.stopped, false);
  f.started.get('grok-s6-client').release();

  await f.waitFor(() => f.started.size === 10);
  assert.equal(f.active.size, 4, 'all peer reviewers run concurrently');
  for (const agent of ['claude', 'grok', 'agy', 'codex']) {
    const claims = readReportJson(f.out, `crosscheck/${agent}.json`);
    assert.equal(claims.length, ['claude', 'grok'].includes(agent) ? 4 : 5);
    assert.ok(claims.every(claim => claim.model !== agent));
    f.started.get(`crosscheck-${agent}`).release();
  }
  assert.deepEqual((await f.run).stageFailures, []);
  assert.equal(f.stopped, true);
  assert.ok(readReportJson(f.out, 'workers.json').jobs.every(job => job.state === 'collected'));
  assert.ok(Object.values(readReportJson(f.out, 'meta.json').crosscheckExits).every(code => code === 0));
});

test('a failed reviewer stays incomplete while other providers and its remaining surfaces finish', { timeout: 10_000 }, async t => {
  const f = fixture(t, ['claude', 'grok']);
  await f.waitFor(() => f.started.size === 2);
  f.started.get('claude-s1-auth').release({ code: 1, observedExitCode: 7, failureReason: 'usage_limit' });
  await f.waitFor(() => f.started.has('claude-s3-logic'));
  assert.equal(f.completed.includes('grok-s2-input'), false);
  for (const name of ['claude-s3-logic', 'claude-s5-deps', 'grok-s2-input', 'grok-s4-config', 'grok-s6-client', 'crosscheck-claude', 'crosscheck-grok']) {
    await f.waitFor(() => f.started.has(name));
    f.started.get(name).release();
  }
  const result = await f.run;
  assert.deepEqual(result.stageFailures, ['auditor_error:claude-s1-auth']);
  const failed = readReportJson(f.out, 'workers.json').jobs.find(job => job.name === 'claude-s1-auth');
  assert.equal(failed.state, 'failed');
  assert.equal(failed.failure.reason, 'usage_limit');
  assert.equal(failed.observedExitCode, 7);
  assert.equal(f.started.size, 8, 'no retry or provider substitution');
  assert.equal(f.stopped, true);
});

test('cancellation reaches all active providers, skips queued surfaces and waits before teardown', { timeout: 10_000 }, async t => {
  const f = fixture(t);
  await f.waitFor(() => f.started.size === 4);
  process.emit('SIGINT');
  assert.ok([...f.started.values()].every(options => options.signal.aborted));
  for (const name of ['claude-s1-auth', 'grok-s2-input', 'agy-s3-logic']) f.started.get(name).release({ code: 130, failureReason: 'cancelled' });
  await f.waitFor(() => f.completed.length === 3);
  assert.equal(f.stopped, false, 'the last active provider still owns the sandbox');
  f.started.get('codex-s4-config').release({ code: 130, failureReason: 'cancelled' });
  assert.equal((await f.run).cancelled, true);
  assert.equal(f.started.size, 4);
  const queued = readReportJson(f.out, 'workers.json').jobs.filter(job => ['s5', 's6'].includes(job.surface.id));
  assert.ok(queued.every(job => job.state === 'cancelled'));
  assert.equal(f.stopped, true);
});
