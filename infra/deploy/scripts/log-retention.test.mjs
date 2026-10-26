// Actual Ubuntu/systemd/nginx acceptance. All mutable state is in owned containers/volumes; no host daemon config or logs are changed.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const out = mkdtempSync(join(tmpdir(), 'fc-log-retention-')), name = `fc-log-retention-${process.pid}-${randomBytes(3).toString('hex')}`, volume = `${name}-socket`, producer = `${name}-producer`;
let localDocker = false;
const report = { checks: [], fixture: 'isolated Ubuntu systemd; imported historical journal entries, no elapsed-month claim', output: out };
const docker = (args, options = {}) => {
  const r = spawnSync('docker', args, { encoding: 'utf8', timeout: 120000, ...options });
  if (!options.allowFailure) assert.equal(r.status, 0, `${args.join(' ')}\n${r.stderr}\n${r.stdout}`);
  return r;
};
const exec = (args, options) => docker(['exec', name, ...args], options);
const sh = script => exec(['bash', '-c', script]).stdout;
const check = (label, condition) => { assert(condition, label); report.checks.push(label); console.log(`ok ${label}`); };
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(fn) { for (let i = 0; i < 60; i++) { if (fn()) return true; await sleep(500); } return false; }
try {
  const endpoint = process.env.DOCKER_HOST || docker(['context', 'inspect', '--format', '{{.Endpoints.docker.Host}}']).stdout.trim();
  check('Docker endpoint is local', /^(unix:|npipe:|tcp:\/\/(localhost|127\.0\.0\.1|\[::1\]):)/.test(endpoint));
  localDocker = true;
  if (!process.argv.includes('--no-build')) docker(['build', '-f', join(root, 'infra/deploy/logging/Dockerfile.test'), '-t', 'freightchain-log-retention-test:local', join(root, 'infra/deploy/logging')], { timeout: 600000 });
  const model = JSON.parse(docker(['compose', '--env-file', join(root, 'infra/deploy/.env.example'), '-f', join(root, 'infra/deploy/docker-compose.prod.yml'), 'config', '--format', 'json']).stdout);
  check('all production service logs go only to the owned namespace', Object.entries(model.services).every(([service, spec]) => spec.logging.driver === 'syslog' && spec.logging.options['syslog-address'] === 'unixgram:///run/systemd/journal.freightchain/dev-log' && spec.logging.options['cache-disabled'] === 'true' && spec.logging.options.tag === `fc-${service}`));
  docker(['volume', 'create', volume]);
  const mount = docker(['volume', 'inspect', '--format', '{{.Mountpoint}}', volume]).stdout.trim();
  docker(['run', '-d', '--name', name, '--privileged', '--cgroupns=private', '--network', 'none', '--tmpfs', '/run', '--tmpfs', '/tmp', '-v', `${volume}:/run/systemd/journal.freightchain`, 'freightchain-log-retention-test:local']);
  check('isolated Ubuntu systemd boots', await until(() => exec(['systemctl', 'is-system-running'], { allowFailure: true }).status === 0));
  report.systemd = sh('systemd --version | head -1').trim(); report.os = sh('cat /etc/os-release');
  sh('mkdir -p /srv/fc/state');
  docker(['cp', join(root, 'infra/deploy/logging'), `${name}:/srv/fc/state/logging`]);
  docker(['cp', join(root, 'infra/deploy/scripts/remote/logging.sh'), `${name}:/srv/fc/state/logging.sh`]);
  docker(['cp', join(root, 'infra/deploy/scripts/remote/ops.sh'), `${name}:/srv/fc/ops.sh`]);
  docker(['cp', join(root, 'infra/deploy/scripts/remote/ctl.sh'), `${name}:/srv/fc/ctl.sh`]);
  exec(['bash', '/srv/fc/state/logging.sh', 'install', 'DEPLOY_PATH=/srv/fc']);
  check('collector socket and hourly expiry timer are active', sh('systemctl is-active freightchain-log-collector.service freightchain-log-retention.timer').trim() === 'active\nactive');
  check('only the owned stack gets collector boot ordering', sh('systemctl show freightchain-stack.service -p After -p Requires').includes('freightchain-log-collector.service') && sh('systemctl is-enabled freightchain-stack.service').trim() === 'enabled');
  check('namespace does not forward into other host logs', sh('systemd-analyze cat-config systemd/journald@freightchain.conf').includes('ForwardToSyslog=no'));
  const marker = `api-retention-${process.pid}`;
  docker(['create', '--name', producer, '--network', 'none', '--log-driver', 'syslog', '--log-opt', `syslog-address=unixgram://${mount}/dev-log`, '--log-opt', 'tag=fc-app', '--log-opt', 'cache-disabled=true', 'alpine:3', 'echo', JSON.stringify({ level: 'warn', msg: marker })]);
  docker(['start', producer]); docker(['wait', producer]);
  check('Docker syslog reaches the real namespace', await until(() => sh('journalctl --namespace=freightchain -o cat --no-pager -t fc-app').includes(marker)));
  check('Docker has no duplicate persistent cache', docker(['logs', producer], { allowFailure: true }).status !== 0);
  sh(`cat > /usr/local/bin/docker <<'STUB'
#!/bin/sh
printf '%s\n' "$*" >> /tmp/docker-calls
case "$1" in ps) echo fixture-id ;; inspect) echo syslog ;; compose) echo 'driver: syslog' ;; *) exit 1 ;; esac
STUB
chmod +x /usr/local/bin/docker
printf fixture > /srv/fc/state/current`);
  check('ops reads real JSON logs with relative time/error filters', exec(['bash', '/srv/fc/ops.sh', 'logs', 'SERVICE=app', 'SINCE=30m', 'ERRORS=1']).stdout.includes(marker));
  check('deploy:logs reads the same namespace', exec(['bash', '/srv/fc/ctl.sh', 'logs', 'DEPLOY_PATH=/srv/fc', 'APP_PORT=18080']).stdout.includes(marker));
  sh(`printf '' > /srv/fc/.env
cat > /etc/systemd/system/docker.service <<'UNIT'
[Service]
Type=oneshot
RemainAfterExit=yes
ExecStart=/bin/true
UNIT
systemctl daemon-reload
systemctl start freightchain-stack.service`);
  check('boot unit restores only the declared project after collector readiness', sh('cat /tmp/docker-calls').includes('compose --env-file /srv/fc/.env -f /srv/fc/releases/fixture/deploy/docker-compose.prod.yml up -d --no-build postgres redis app worker'));

  sh(`cat > /etc/nginx/sites-available/freightchain <<'SITE'
server {
 listen 18080;
 server_name fc.test;
 location / { return 200 'owned'; }
 location /error { proxy_pass http://127.0.0.1:9; }
}
SITE
cat > /etc/nginx/sites-available/unrelated <<'SITE'
server {
 listen 18081;
 server_name unrelated.test;
 location / { return 200 'unrelated'; }
}
SITE
ln -s /etc/nginx/sites-available/freightchain /etc/nginx/sites-enabled/freightchain
ln -s /etc/nginx/sites-available/unrelated /etc/nginx/sites-enabled/unrelated
sha256sum /etc/nginx/sites-available/unrelated > /tmp/unrelated.sha`);
  exec(['bash', '/srv/fc/state/logging.sh', 'nginx', 'DEPLOY_PATH=/srv/fc']);
  exec(['bash', '/srv/fc/state/logging.sh', 'nginx', 'DEPLOY_PATH=/srv/fc']);
  sh('sha256sum --check /tmp/unrelated.sha');
  check('owned nginx setup is idempotent and unrelated site unchanged', sh("grep -c 'include /etc/nginx/snippets/freightchain-logging.conf;' /etc/nginx/sites-available/freightchain").trim() === '1');
  await sleep(500);
  exec(['python3', '-c', "import urllib.request,urllib.error\nfor u in ['http://127.0.0.1:18080/fc-access-marker','http://127.0.0.1:18080/error/fc-error-marker','http://127.0.0.1:18081/unrelated-marker']:\n try: urllib.request.urlopen(u).read()\n except urllib.error.HTTPError: pass"]);
  check('owned nginx access and error logs arrive in the namespace', await until(() => exec(['bash', '/srv/fc/ops.sh', 'nginx']).stdout.includes('fc-access-marker') && exec(['bash', '/srv/fc/ops.sh', 'nginx', 'WHICH=error']).stdout.includes('fc-error-marker')));
  check('owned requests do not leak into inherited shared logs', !sh('cat /var/log/nginx/access.log /var/log/nginx/error.log').includes('fc-access-marker') && !sh('cat /var/log/nginx/error.log').includes('fc-error-marker'));
  check('unrelated nginx remains outside the namespace', sh('cat /var/log/nginx/access.log').includes('unrelated-marker') && !sh('journalctl --namespace=freightchain --no-pager -o cat').includes('unrelated-marker'));
  const ownedBefore = sh('cat /etc/nginx/sites-available/freightchain');
  sh("printf '\ninvalid_nginx_directive;\n' >> /srv/fc/state/logging/nginx.conf");
  check('invalid logging config restores the existing owned nginx files', exec(['bash', '/srv/fc/state/logging.sh', 'nginx', 'DEPLOY_PATH=/srv/fc'], { allowFailure: true }).status !== 0 && sh('cat /etc/nginx/sites-available/freightchain') === ownedBefore);
  sh('nginx -t');
  const historical = `import pathlib,time,subprocess,uuid,os,json
machine=pathlib.Path('/etc/machine-id').read_text().strip()
records=[]
for namespace,days,label in [('freightchain',40,'expired-owned'),('freightchain',2,'recent-owned'),('unrelated',40,'expired-unrelated')]:
 directory=pathlib.Path('/var/log/journal')/(machine+'.'+namespace);directory.mkdir(parents=True,exist_ok=True)
 stamp=int((time.time()-days*86400)*1e6); key=uuid.uuid4().hex
 file=directory/('system@'+key+'-0000000000000001-'+format(stamp,'016x')+'.journal')
 data='__REALTIME_TIMESTAMP='+str(stamp)+'\\n__MONOTONIC_TIMESTAMP=1\\n_BOOT_ID='+key+'\\n_MACHINE_ID='+machine+'\\nSYSLOG_IDENTIFIER=fc-aged\\nMESSAGE='+label+'\\n\\n'
 subprocess.run(['/usr/lib/systemd/systemd-journal-remote','--output='+str(file),'-'],input=data,text=True,check=True,capture_output=True)
 os.utime(file,(stamp/1e6,stamp/1e6));records.append({'file':str(file),'label':label})
pathlib.Path('/tmp/historical.json').write_text(json.dumps(records))
print(json.dumps(records))`;
  report.historical = JSON.parse(exec(['python3', '-c', historical]).stdout);
  check('native journal reads imported historical fixture before cleanup', sh('journalctl --namespace=freightchain --no-pager -o cat -t fc-aged').includes('expired-owned'));
  exec(['systemctl', 'start', 'freightchain-log-retention.service']);
  check('real journal expiry removes aged owned bytes and preserves recent/unrelated files', exec(['python3', '-c', "import json,pathlib; rows=json.loads(pathlib.Path('/tmp/historical.json').read_text()); assert [pathlib.Path(r['file']).exists() for r in rows]==[False,True,True]"]).status === 0);
  check('expiry remains readable and excludes removed entries', sh('journalctl --namespace=freightchain --no-pager -o cat -t fc-aged').includes('recent-owned') && !sh('journalctl --namespace=freightchain --no-pager -o cat -t fc-aged').includes('expired-owned'));
  exec(['systemctl', 'stop', 'freightchain-log-retention.timer']);
  check('deployment refuses a missing expiry timer', exec(['bash', '/srv/fc/state/logging.sh', 'check'], { allowFailure: true }).status !== 0);
  exec(['systemctl', 'start', 'freightchain-log-retention.timer']);
  exec(['systemctl', 'stop', 'systemd-journald@freightchain.service', 'systemd-journald@freightchain.socket', 'systemd-journald-varlink@freightchain.socket']);
  check('deployment refuses an absent collector', exec(['bash', '/srv/fc/state/logging.sh', 'check'], { allowFailure: true }).status !== 0);
  const missing = `${producer}-missing`;
  const refusal = docker(['run', '--rm', '--name', missing, '--network', 'none', '--log-driver', 'syslog', '--log-opt', `syslog-address=unixgram://${mount}/absent`, '--log-opt', 'cache-disabled=true', 'alpine:3', 'echo', 'must-not-run'], { allowFailure: true });
  docker(['rm', '-f', missing], { allowFailure: true });
  check('Docker refuses container startup if its collector socket is absent', refusal.status !== 0 && /logging|syslog|socket|connect/.test(refusal.stderr));
  report.passed = true;
} catch (error) { report.error = error.stack; console.error(error); process.exitCode = 1; }
finally {
  if (localDocker) {
    const diagnostics = docker(['exec', name, 'journalctl', '--namespace=freightchain', '--no-pager', '-n', '100'], { allowFailure: true });
    writeFileSync(join(out, 'journal.log'), diagnostics.stdout + diagnostics.stderr);
    docker(['rm', '-f', producer, name], { allowFailure: true }); docker(['volume', 'rm', volume], { allowFailure: true });
  }
  writeFileSync(join(out, 'result.json'), JSON.stringify(report, null, 2) + '\n'); console.log(`evidence: ${out}`);
}
