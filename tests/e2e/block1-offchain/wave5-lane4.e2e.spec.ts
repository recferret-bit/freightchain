import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { runGrantHold } from '../../../backend/server/scripts/wave5-grant-hold.mjs';

const root = fileURLToPath(new URL('../../../', import.meta.url));

function runChrome(script, chromePort) {
  const run = spawnSync(process.execPath, [fileURLToPath(new URL(`../../../backend/server/scripts/${script}`, import.meta.url))], {
    cwd: root,
    env: { ...process.env, PORT: '3104', CHROME_PORT: chromePort },
    encoding: 'utf8',
    timeout: 120_000,
  });
  const out = `${run.stdout ?? ''}\n${run.stderr ?? ''}`;
  assert.equal(run.status, 0, out);
  assert.doesNotMatch(out, /Chrome did not start/);
  return out;
}

test('RPL-T-30..60 and RPL-T-16..29 a recorded ride drives clock, camera, and seek, and the lobby shows Russian', { timeout: 180_000 }, () => {
  const replay = runChrome('e2e-replay-controls.mjs', '9374');
  for (const line of ['clock advances while playing', 'camera changes – cabin -> chase', 'seek lands on the recorded second', 'C9 absent', 'C26 absent', 'C27 absent', 'C32 absent', 'C1 #w-play', 'C36 #w-react']) {
    assert.match(replay, new RegExp(line));
  }
  const i18n = runChrome('e2e-i18n-legal.mjs', '9375');
  assert.match(i18n, /ПОВТОРЫ/);
  assert.match(i18n, /chrome data-i18n nodes are translated/);
  assert.match(i18n, /untranslated 0/);
});

test('REF-T-01..22 and TEN-T-10..15 convoy clock jump and airdrop social bind release only after 48 hours', async () => {
  const hold = await runGrantHold();
  assert.equal(hold.m1OnEarn, false);
  assert.equal(hold.m1After48h, true);
  assert.equal(hold.trustAfterSocial, 70);
  assert.equal(hold.claimBefore48h, false);
  assert.equal(hold.claimAfter48h, true);
});
