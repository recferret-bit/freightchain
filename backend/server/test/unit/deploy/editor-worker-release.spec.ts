import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

// Exercise the actual release/rollback shell code with fake Docker and HTTP. No production or real containers.
type Call = { tag: string; args: string[] };
function fixture(oldWorker: boolean, failure = '') {
  const root = mkdtempSync(join(tmpdir(), 'fc-editor-release-')), bin = join(root, 'bin'), log = join(root, 'calls');
  mkdirSync(bin); mkdirSync(join(root, 'state'));
  for (const tag of ['new', 'old']) { mkdirSync(join(root, 'releases', tag, 'deploy'), { recursive: true }); writeFileSync(join(root, 'releases', tag, 'deploy', 'docker-compose.prod.yml'), '# fixture'); }
  const logging = join(root, 'releases', 'new', 'infra', 'deploy', 'scripts', 'remote');
  mkdirSync(logging, { recursive: true });
  // Namespace/systemd behavior has its own Ubuntu test; this fixture isolates release ordering.
  writeFileSync(join(logging, 'logging.sh'), '#!/bin/sh\n[ "$1" = check ] && [ "$FC_MOCK_FAILURE" != logging ]\n');
  writeFileSync(join(root, 'state', 'setup-done'), '');
  writeFileSync(join(root, 'state', 'current'), 'old');
  writeFileSync(join(root, 'state', 'previous'), 'old');
  writeFileSync(join(root, '.env'), 'EDITOR_MCP_TOKEN=dummy-editor-token-for-release-tests\n');
  writeFileSync(log, '');
  writeFileSync(join(bin, 'docker'), `#!${process.execPath}
const fs=require('fs'), a=process.argv.slice(2), tag=process.env.RELEASE||'';
fs.appendFileSync(process.env.FC_MOCK_LOG,JSON.stringify({tag,args:a})+'\\n');
if(a[0]==='inspect') { console.log(process.env.FC_MOCK_FAILURE==='health'&&a.at(-1)==='new:editor-worker'?'unhealthy':'healthy'); }
if(a[0]==='compose') {
 if(a.includes('config')) console.log('postgres\\nredis\\napp\\nworker\\nmcp'+(tag==='new'||process.env.FC_MOCK_OLD_WORKER==='1'?'\\neditor-worker':''));
 if(a.includes('ps')) console.log(a.includes('-q')?tag+':'+a.at(-1):'postgres');
 if(a.includes('up')&&a.includes('app')&&tag==='new'&&process.env.FC_MOCK_FAILURE==='up') process.exit(1);
 if(a.includes('exec')) console.log('-- dummy backup');
}
`, { mode: 0o755 });
  for (const command of ['curl', 'sleep']) writeFileSync(join(bin, command), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
  const env = { ...process.env, PATH: `${bin}:${process.env.PATH}`, FC_MOCK_LOG: log, FC_MOCK_FAILURE: failure, FC_MOCK_OLD_WORKER: oldWorker ? '1' : '0' };
  const run = (manual = false) => {
    if (manual) { writeFileSync(join(root, 'state', 'current'), 'new'); writeFileSync(join(root, 'state', 'previous'), 'old'); }
    return spawnSync('bash', [resolve('../../infra/deploy/scripts/remote', manual ? 'ctl.sh' : 'release.sh'), ...(manual ? ['rollback'] : []), `DEPLOY_PATH=${root}`, 'RELEASE=new', 'APP_PORT=13000', 'KEEP_RELEASES=5', 'KEEP_BACKUPS=5'], { env, encoding: 'utf8' });
  };
  return { root, run, calls: (): Call[] => readFileSync(log, 'utf8').trim().split('\n').filter(Boolean).map(l => JSON.parse(l) as Call), close: () => rmSync(root, { recursive: true, force: true }) };
}
const appUp = (c: Call) => c.args.includes('up') && c.args.includes('app');
describe('dedicated editor worker release lifecycle', () => {
  it('refuses the release before building or swapping anything when logging is unavailable', () => {
    const f = fixture(true, 'logging');
    try {
      expect(f.run().status).toBe(1);
      expect(f.calls()).toEqual([]);
      expect(readFileSync(join(f.root, 'state', 'current'), 'utf8').trim()).toBe('old');
    } finally { f.close(); }
  });

  it('a successful release starts the matching worker and gates success on its health', () => {
    const f = fixture(true);
    try {
      const r = f.run(); expect(r.status, r.stderr).toBe(0);
      expect(f.calls().find(c => c.tag === 'new' && appUp(c))!.args.slice(-4)).toEqual(['app', 'worker', 'mcp', 'editor-worker']);
      expect(f.calls().some(c => c.args[0] === 'inspect' && c.args.at(-1) === 'new:editor-worker')).toBe(true);
      expect(readFileSync(join(f.root, 'state', 'current'), 'utf8').trim()).toBe('new');
    } finally { f.close(); }
  });

  for (const failure of ['health', 'up']) it(`a failed ${failure} stops the new worker before rolling back to a release without that service`, () => {
    const f = fixture(false, failure);
    try {
      const r = f.run(); expect(r.status, r.stderr).toBe(1);
      const calls = f.calls(), rollback = calls.findIndex(c => c.tag === 'old' && appUp(c));
      expect(rollback).toBeGreaterThan(0);
      expect(calls.slice(0, rollback).filter(c => c.tag === 'new' && c.args.includes('stop') && c.args.includes('editor-worker'))).toHaveLength(2);
      expect(calls[rollback]!.args).not.toContain('editor-worker');
      expect(readFileSync(join(f.root, 'state', 'current'), 'utf8').trim()).toBe('old');
    } finally { f.close(); }
  });

  it('manual rollback starts an older matching AI worker when available', () => {
    const f = fixture(true);
    try {
      const r = f.run(true); expect(r.status, r.stderr).toBe(0);
      const calls = f.calls(), rollback = calls.findIndex(c => c.tag === 'old' && appUp(c));
      expect(calls[rollback]!.args).toContain('editor-worker');
      expect(calls.slice(0, rollback).some(c => c.tag === 'new' && c.args.includes('stop') && c.args.includes('editor-worker'))).toBe(true);
      expect(readFileSync(join(f.root, 'state', 'current'), 'utf8').trim()).toBe('old');
    } finally { f.close(); }
  });
});
