import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

// The REAL game modules + the REAL keyboard driver in Node (normal-drive-headless.mjs): minutes of game time in seconds of wall time.
const headless = fileURLToPath(new URL('./normal-drive-headless.mjs', import.meta.url));
const run = async (...args) => { try { return { code: 0, ...(await promisify(execFile)('node', [headless, ...args], { maxBuffer: 1 << 26, timeout: 240_000 })) }; } catch (e) { return { code: e.code, stdout: e.stdout ?? '', stderr: e.stderr ?? '' }; } };
const result = out => out.split('\n').find(l => l.startsWith('RESULT')) ?? '';
const hull = line => +/hull=([\d.]+)/.exec(line)?.[1];

test('EASY drives the whole course undamaged', async () => {
  const r = await run('--level', 'EASY', '--route', 'stuart', '--seed', '11');
  assert.equal(r.code, 0, r.stdout.slice(-600));
  assert.match(result(r.stdout), /RESULT complete .*hull=100\.0/);
});

test('HARD seed of the failed 2026-10-26 run: no standstill past a toll with a damaged truck, finishes with hull left', async () => {
  // Before the driver fix this seed pinned the truck at ~0.01 m/s (a damaged hull cannot launch from the clutch-slip revs: pull 0.06 < rolling resistance 0.18)
  // and the overshooting lane changes cost ~70 % hull on the roadside props.
  const r = await run('--level', 'HARD', '--route', 'brenner', '--seed', '1139766526');
  assert.equal(r.code, 0, r.stdout.slice(-800));
  assert.doesNotMatch(r.stdout, /^STUCK/m);
  const line = result(r.stdout);
  assert.match(line, /RESULT complete/);
  assert.ok(hull(line) > 50, line);
});

test('a truck that cannot move trips the stuck watchdog quickly instead of running to the deadline', async () => {
  const r = await run('--level', 'HARD', '--seed', '1139766526', '--stuck', '0.5', '--max-s', '400');   // 0.5 s: the depot start itself is a standstill
  assert.equal(r.code, 1);
  assert.match(r.stdout, /^STUCK truck below 1 m\/s/m);
  assert.match(r.stdout, /RESULT stuck/);
});
