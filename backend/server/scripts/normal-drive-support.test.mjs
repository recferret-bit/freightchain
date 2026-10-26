import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { boundedFetch, snapshotSource, sha256, stopOwnedChild, withDeadline, healthWatchdog } from './normal-drive-support.mjs';

test('HTTP requests abort and deadlines reject instead of reporting success', async () => {
  const server = createServer(() => {});
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    await assert.rejects(boundedFetch(`http://127.0.0.1:${server.address().port}`, {}, 30), /timeout|abort/i);
    await assert.rejects(withDeadline(() => new Promise(() => {}), 20, 'fixture'), /fixture timed out/);
    assert.equal(await withDeadline(() => 7, 100), 7);
  } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
});

test('snapshot records actual dirty source bytes and excludes env, keys and build output', () => {
  const root = mkdtempSync(join(tmpdir(), 'fc-source-fixture-')), out = mkdtempSync(join(tmpdir(), 'fc-source-copy-'));
  const put = (name, value) => { mkdirSync(join(root, name, '..'), { recursive: true }); writeFileSync(join(root, name), value); };
  try {
    execFileSync('git', ['init', '-q', root]);
    put('frontend/client/js/main.js', 'initial');
    execFileSync('git', ['-C', root, 'add', '.']);
    execFileSync('git', ['-C', root, '-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', '-c', 'commit.gpgsign=false', 'commit', '-qm', 'fixture']);
    put('frontend/client/js/main.js', 'changed'); put('backend/server/scripts/new.mjs', 'new');
    put('backend/server/.env', 'secret'); put('frontend/client/.keys/wallet.json', 'secret'); put('backend/server/dist/main.js', 'stale');
    const manifest = snapshotSource(root, out);
    assert.equal(readFileSync(join(out, 'frontend/client/js/main.js'), 'utf8'), 'changed');
    assert.equal(manifest.files['frontend/client/js/main.js'], sha256('changed'));
    assert.equal(manifest.files['backend/server/scripts/new.mjs'], sha256('new'));
    assert.equal(Object.keys(manifest.files).length, 2);
    assert.equal(existsSync(join(out, 'backend/server/.env')), false);
  } finally { rmSync(root, { recursive: true, force: true }); rmSync(out, { recursive: true, force: true }); }
});

test('owned cleanup escalates a stubborn child, is repeatable, and leaves unrelated child alive', async () => {
  const start = () => spawn(process.execPath, ['-e', 'process.on("SIGTERM",()=>{});setInterval(()=>{},1000);process.stdout.write("ready")'], { stdio: ['ignore', 'pipe', 'ignore'] });
  const owned = start(), unrelated = start();
  await Promise.all([owned, unrelated].map(child => new Promise(resolve => child.stdout.once('data', resolve))));
  try {
    await stopOwnedChild(owned, 100); await stopOwnedChild(owned, 100);
    assert.equal(owned.signalCode, 'SIGKILL'); assert.equal(unrelated.exitCode, null); assert.equal(unrelated.signalCode, null);
  } finally { await stopOwnedChild(unrelated, 100); }
});


test('health watchdog tolerates a brief outage, resets after recovery and fails a sustained outage', async () => {
  let ticks = 0;
  const monitor = healthWatchdog(async () => { ticks++; if (ticks === 2) throw new Error('temporary network refusal'); return ticks === 3; }, { intervalMs: 1, maxUnavailableMs: 30, now: () => ticks * 10 });
  try { await assert.rejects(monitor.failure, /unavailable for 30ms/); assert.equal(ticks, 7); }
  finally { monitor.stop(); }
});

test('stopped watchdog ignores a late unavailable probe', async () => {
  let reply, calls = 0;
  const monitor = healthWatchdog(() => { calls++; return new Promise(resolve => { reply = resolve; }); }, { intervalMs: 1, maxUnavailableMs: 0 });
  monitor.stop(); reply(false);
  const result = await Promise.race([monitor.failure.then(() => 'failed', () => 'failed'), new Promise(resolve => setTimeout(() => resolve('stopped'), 20))]);
  assert.equal(result, 'stopped'); assert.equal(calls, 1);
});
