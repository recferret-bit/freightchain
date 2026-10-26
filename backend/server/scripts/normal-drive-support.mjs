// Helpers for the opt-in acceptance harness; no application runtime imports.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';

export const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
export const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
export const boundedFetch = (url, options = {}, timeoutMs = 15_000) => fetch(url, { ...options, signal: options.signal ? AbortSignal.any([options.signal, AbortSignal.timeout(timeoutMs)]) : AbortSignal.timeout(timeoutMs) });

// A timeout rejects to the caller's owned-process cleanup; it never silently marks work complete.
export async function withDeadline(operation, timeoutMs, label = 'operation') {
  let timer;
  try { return await Promise.race([Promise.resolve().then(operation), new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`${label} timed out`)), timeoutMs); })]); }
  finally { clearTimeout(timer); }
}

/** Copy only versioned/source files, never env files, private keys, build output or dependencies. */
export function snapshotSource(root, destination) {
  const git = args => execFileSync('git', args, { cwd: root, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
  const paths = git(['ls-files', '--cached', '--others', '--exclude-standard', '-z']).split('\0').filter(Boolean);
  const files = {};
  for (const name of [...new Set(paths)].sort()) {
    if (!/^(frontend\/(client|shared)\/|backend\/server\/(src\/|prisma\/|scripts\/|(?:package(?:-lock)?|tsconfig(?:\.build)?|nest-cli)\.json$))/.test(name)) continue;
    if (name.startsWith('backend/server/scripts/') && !/\.(?:mjs|cjs|js|ts|sh)$/.test(name)) continue;
    if (/(^|\/)(?:\.env(?:\.|$)|\.keys(?:\/|$)|node_modules\/|dist\/)/.test(name)) continue;
    const bytes = readFileSync(join(root, name)), target = join(destination, name);
    mkdirSync(dirname(target), { recursive: true }); writeFileSync(target, bytes); files[name] = sha256(bytes);
  }
  return { head: git(['rev-parse', 'HEAD']).trim(), sourceSha256: sha256(JSON.stringify(files)), files };
}

export function treeHashes(directory, prefix = '') {
  const files = {};
  for (const entry of readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const name = prefix + entry.name, path = join(directory, entry.name);
    if (entry.isDirectory()) Object.assign(files, treeHashes(path, name + '/'));
    else if (entry.isFile()) files[name] = sha256(readFileSync(path));
  }
  return files;
}

/** Only exact ChildProcess handles created by this run; never process-name or port-based killing. */
export async function stopOwnedChild(child, graceMs = 5000) {
  if (child.exitCode !== null || child.signalCode !== null || !child.pid) return;
  const exited = new Promise(resolve => child.once('exit', resolve));
  child.kill('SIGTERM');
  await withDeadline(() => exited, graceMs, 'graceful shutdown').catch(() => {});
  if (child.exitCode === null && child.signalCode === null) {
    child.kill('SIGKILL'); await withDeadline(() => exited, graceMs, 'forced shutdown').catch(() => {});
    if (child.exitCode === null && child.signalCode === null) throw new Error(`owned child ${child.pid} did not exit`);
  }
}
