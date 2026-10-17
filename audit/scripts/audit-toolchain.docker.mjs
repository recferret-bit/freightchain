import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { spawnSync } from 'node:child_process';
import { EXISTING_TEST_RUNNER } from './review-workflow.mjs';
import { resolveDockerBin } from './docker-mcp-bridge.mjs';

test('provisioned Rust runs real tests offline as non-root with a read-only toolchain', { timeout: 60_000 }, t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'audit-rust-toolchain-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.chmodSync(root, 0o755);
  fs.mkdirSync(path.join(root, 'src'));
  const manifest = '[package]\nname="inert-toolchain-fixture"\nversion="0.1.0"\nedition="2021"\n';
  fs.writeFileSync(path.join(root, 'Cargo.toml'), manifest);
  fs.writeFileSync(path.join(root, 'Cargo.lock'), 'version = 3\n[[package]]\nname="inert-toolchain-fixture"\nversion="0.1.0"\n');
  fs.writeFileSync(path.join(root, 'rust-toolchain.toml'), '[toolchain]\nchannel="1.89.0"\ncomponents=["clippy","rustfmt"]\n');
  fs.writeFileSync(path.join(root, 'src/lib.rs'), '#[test]\nfn inert_existing_test() { assert_eq!(2 + 2, 4); }\n');
  const entry = { cwd: '.', command: 'cargo', args: ['test', '--locked', '--offline'], files: [{ path: 'Cargo.toml', sha256: crypto.createHash('sha256').update(manifest).digest('hex') }] };
  const result = spawnSync(resolveDockerBin(), ['run', '--interactive', '--rm', '--pull=never', '--network', 'none', '--read-only', '--user', '10001:10001', '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges', '--tmpfs', '/tmp:mode=1777', '--tmpfs', '/work:mode=1777,exec', '--env', 'CARGO_HOME=/work/cargo', '--env', 'CARGO_TARGET_DIR=/work/target', '--mount', `type=bind,src=${root},dst=/work/src,readonly`, '--entrypoint', 'node', 'audit-sandbox:local', '-e', EXISTING_TEST_RUNNER], { encoding: 'utf8', input: JSON.stringify(entry), timeout: 45_000, maxBuffer: 1024 * 1024 });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /test result: ok\. 1 passed; 0 failed; 0 ignored/);
  assert.doesNotMatch(result.stderr, /syncing channel|Read-only file|Downloading/);
});

test('manifest-only cache preparation executes no target build script and refuses custom sources', { timeout: 60_000 }, t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'audit-cargo-preparation-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.chmodSync(root, 0o755);
  const manifest = '[package]\nname="inert-prepare-fixture"\nversion="0.1.0"\nedition="2021"\n';
  fs.writeFileSync(path.join(root, 'Cargo.toml'), manifest);
  fs.writeFileSync(path.join(root, 'Cargo.lock'), 'version = 3\n[[package]]\nname="inert-prepare-fixture"\nversion="0.1.0"\n');
  fs.writeFileSync(path.join(root, 'build.rs'), 'fn main() { panic!("Target build scripts must never execute during fetch"); }');
  const run = () => spawnSync(resolveDockerBin(), ['run', '--rm', '--pull=never', '--network', 'none', '--read-only', '--user', '10001:10001', '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges', '--tmpfs', '/tmp:mode=1777', '--tmpfs', '/work:mode=1777', '--mount', `type=bind,src=${root},dst=/work/src,readonly`, '--entrypoint', 'python3', 'audit-sandbox:local', '/opt/prepare-cargo-cache.py'], { encoding: 'utf8', timeout: 30_000, maxBuffer: 1024 * 1024 });
  const prepared = run();
  assert.equal(prepared.status, 0, prepared.stderr);
  assert.doesNotMatch(prepared.stderr, /Compiling/);
  fs.writeFileSync(path.join(root, 'Cargo.toml'), manifest + '[dependencies]\nfixture={git="https://example.invalid/unavailable"}\n');
  const rejected = run();
  assert.notEqual(rejected.status, 0);
  assert.match(rejected.stderr, /Custom dependency sources are not prepared/);
  assert.doesNotMatch(rejected.stderr, /Updating git|Downloading/);
});
