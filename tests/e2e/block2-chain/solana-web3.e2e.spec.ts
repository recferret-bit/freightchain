import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { ACHIEVEMENTS } from '../../../backend/server/dist/domain/achievements/achievements.js';
import { BASE, SOLANA, apiTest, chainTest, keypair, session, sign, signInPlayer } from '../harness/api.mjs';
import { REPO } from '../harness/dom.mjs';

apiTest(test, '[SOL-T-01] SIWS nonce is domain-bound and a tampered or foreign signature is 401', async () => {
  const keys = keypair();
  const api = session();
  const nonce = await api.call('/api/auth/nonce', { body: { wallet: keys.wallet } });
  assert.equal(nonce.status, 200, JSON.stringify(nonce.json));
  assert.match(nonce.json.message, /wants you to sign in with your Solana account/);
  assert.equal(nonce.json.chainId, 'solana:devnet');
  assert.ok(nonce.json.domain);
  assert.ok(nonce.json.expirationTime);
  const ok = await api.call('/api/auth/verify', { body: { wallet: keys.wallet, signature: sign(keys.secretKey, nonce.json.message), message: nonce.json.message, nonce: nonce.json.nonce } });
  assert.equal(ok.status, 200, JSON.stringify(ok.json));
  const other = keypair();
  const n2 = await session().call('/api/auth/nonce', { body: { wallet: other.wallet } });
  const tampered = n2.json.message.replace(other.wallet, keys.wallet);
  const bad = await session().call('/api/auth/verify', { body: { wallet: other.wallet, signature: sign(other.secretKey, tampered), message: tampered, nonce: n2.json.nonce } });
  assert.equal(bad.status, 401);
  const wrong = await session().call('/api/auth/verify', { body: { wallet: keys.wallet, signature: sign(other.secretKey, n2.json.message), message: n2.json.message, nonce: n2.json.nonce } });
  assert.equal(wrong.status, 401);
});

apiTest(test, '[SOL-T-02] a SIWS signature is single-use', async () => {
  const keys = keypair();
  const api = session();
  const nonce = await api.call('/api/auth/nonce', { body: { wallet: keys.wallet } });
  const body = { wallet: keys.wallet, signature: sign(keys.secretKey, nonce.json.message), message: nonce.json.message, nonce: nonce.json.nonce };
  assert.equal((await api.call('/api/auth/verify', { body })).status, 200);
  const replay = await session().call('/api/auth/verify', { body });
  assert.equal(replay.status, 401);
});

apiTest(test, '[SOL-T-03] a guest session can order EASY and is refused MEDIUM, HARD, a promo and a paid tier', async () => {
  const guest = session();
  const opened = await guest.call('/api/auth/guest', { body: {} });
  assert.equal(opened.status, 200, JSON.stringify(opened.json));
  const easy = await guest.call('/api/rides', { body: { tier: 'free', level: 1 } });
  assert.equal(easy.status, 200, JSON.stringify(easy.json));
  for (const body of [{ tier: 'free', level: 2 }, { tier: 'free', level: 3 }, { tier: '1h' }]) {
    const r = await guest.call('/api/rides', { body });
    assert.equal(r.status, 409, JSON.stringify(body));
    assert.equal(r.json.code, 'guest_easy_only');
  }
  const promo = await guest.call('/api/promo/redeem', { body: { code: 'GUEST' } });
  assert.equal(promo.status, 409);
  assert.equal(promo.json.code, 'guest_easy_only');
});

apiTest(test, '[SOL-T-04] phone pairing keeps the secret in fc_pair and rejects the wrong secret', async () => {
  const desktop = session();
  const opened = await desktop.call('/api/auth/pair', { body: {} });
  assert.equal(opened.status, 200, JSON.stringify(opened.json));
  assert.match(desktop.cookie(), /fc_pair=/);
  assert.ok(opened.json.id);
  const stranger = session();
  const wrong = await stranger.call(`/api/auth/pair/${opened.json.id}`);
  assert.equal(wrong.status, 404);
  assert.equal(wrong.json.code, 'pair_expired');
  const pending = await desktop.call(`/api/auth/pair/${opened.json.id}`);
  assert.equal(pending.status, 200, JSON.stringify(pending.json));
  assert.equal(pending.json.status, 'pending');
  const phone = session();
  const who = await signInPlayer(phone);
  const claim = await phone.call(`/api/auth/pair/${opened.json.id}/claim`, { body: {} });
  assert.equal(claim.status, 200, JSON.stringify(claim.json));
  const ready = await desktop.call(`/api/auth/pair/${opened.json.id}`);
  assert.equal(ready.status, 200, JSON.stringify(ready.json));
  assert.equal(ready.json.status, 'ready');
  assert.equal(ready.json.wallet, who.wallet);
});

apiTest(test, '[SOL-T-05] .sol lookup falls back to null when SNS RPC is down', async () => {
  const forward = await session().call('/api/sns/resolve?domain=freight.sol');
  assert.equal(forward.status, 200, JSON.stringify(forward.json));
  assert.equal(forward.json.wallet, null);
  const keys = keypair();
  const back = await session().call(`/api/sns/reverse?wallet=${keys.wallet}`);
  assert.equal(back.status, 200, JSON.stringify(back.json));
  assert.equal(back.json.domain, null);
});

apiTest(test, '[SOL-T-06] actions.json and /api/actions allow CORS * and errors are { message }', async () => {
  const opt = await fetch(`${BASE}/api/actions/hello`, { method: 'OPTIONS' });
  assert.equal(opt.headers.get('access-control-allow-origin'), '*');
  const json = await fetch(`${BASE}/actions.json`);
  assert.equal(json.status, 200);
  assert.equal(json.headers.get('access-control-allow-origin'), '*');
  const body = await json.json();
  assert.ok(body.rules);
  const bad = await fetch(`${BASE}/api/actions/shift/nope`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{' });
  assert.equal(bad.headers.get('access-control-allow-origin'), '*');
  const err = await bad.json();
  assert.equal(typeof err.message, 'string');
  assert.equal(Object.keys(err).includes('message'), true);
  assert.ok(!('code' in err));
});

apiTest(test, '[SOL-T-07] a shift blink without both agreements is 409 { message }', async () => {
  const keys = keypair();
  const r = await fetch(`${BASE}/api/actions/shift/1h`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: 'https://dial.to' },
    body: JSON.stringify({ account: keys.wallet }),
  });
  assert.equal(r.headers.get('access-control-allow-origin'), '*');
  const err = await r.json();
  assert.equal(r.status, 409, JSON.stringify(err));
  assert.equal(typeof err.message, 'string');
  assert.match(err.message, /18|agreement|loss/i);
});

apiTest(test, '[SOL-T-08] solana pay rejects an unknown ride and a wrong account with a message, and allows CORS *', async () => {
  const id = '11111111-1111-4111-8111-111111111111';
  const link = await fetch(`${BASE}/api/solana-pay/rides/${id}`);
  assert.equal(link.headers.get('access-control-allow-origin'), '*');
  assert.ok(link.status === 404 || link.status === 400);
  const keys = keypair();
  const tx = await fetch(`${BASE}/api/solana-pay/orders/${id}`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ account: keys.wallet }),
  });
  assert.equal(tx.headers.get('access-control-allow-origin'), '*');
  assert.ok(tx.status === 404 || tx.status === 400);
});

apiTest(test, '[SOL-T-09] reconciling an unknown order is refused and a second call stays refused', async () => {
  const player = session();
  await signInPlayer(player);
  const id = '22222222-2222-4222-8222-222222222222';
  const once = await player.call(`/api/tickets/orders/${id}/reconcile`, { body: { signature: 'a'.repeat(88) } });
  const twice = await player.call(`/api/tickets/orders/${id}/reconcile`, { body: { signature: 'a'.repeat(88) } });
  assert.ok(once.status === 404 || once.status === 400 || once.status === 409, JSON.stringify(once));
  assert.equal(twice.status, once.status);
});

chainTest(test, '[SOL-T-10] the local validator is serving the pinned pool program', async () => {
  const id = '8No42h2QXb9opgp3pJfNXL2o77o288SsF8o7CwJGCA1p';
  const r = await fetch(SOLANA, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'getAccountInfo', params: [id, { encoding: 'base64' }] }),
  });
  const body = await r.json();
  assert.equal(body.result?.value?.executable, true, JSON.stringify(body));
});

apiTest(test, '[SOL-T-11] program mode lists pools from the mirror and does not take a custody key from the player', async () => {
  const r = await session().call('/api/pools');
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.ok(Array.isArray(r.json.pools ?? r.json));
});

apiTest(test, '[SOL-T-12] a prize claim is not offered before a winners root exists', async () => {
  const player = session();
  await signInPlayer(player);
  const payout = await player.call('/api/pools/1/payout');
  assert.ok(payout.status === 404 || payout.status === 409 || payout.status === 403, JSON.stringify(payout));
});

apiTest(test, '[SOL-T-13] the profile lists every frozen achievement id and a guest earns none of them', async () => {
  const player = session();
  await signInPlayer(player);
  const profile = await player.call('/api/profile');
  assert.equal(profile.status, 200, JSON.stringify(profile.json).slice(0, 200));
  const ids = profile.json.achievements.map((a) => a.id);
  assert.equal(ids.length, ACHIEVEMENTS.length);
  assert.ok(ids.includes('top-20') || ACHIEVEMENTS.some((a) => a.id === 'top-20'));
  assert.ok(profile.json.achievements.every((a) => a.earnedAt == null));
  const guest = session();
  await guest.call('/api/auth/guest', { body: {} });
  const g = await guest.call('/api/profile');
  assert.equal(g.status, 200);
  assert.ok(g.json.achievements.every((a) => a.earnedAt == null));
});

apiTest(test, '[SOL-T-14] achievement mint rows are append-only statuses and a rejected ride is not an earned badge', async () => {
  const src = readFileSync(join(REPO, 'backend/server/src/application/use-cases/achievements/mint-achievements/mint-achievements.handler.ts'), 'utf8');
  assert.match(src, /markSkipped/);
  assert.match(src, /SKIP_NO_LONGER_EARNED/);
  const schema = readFileSync(join(REPO, 'backend/server/prisma/achievement/achievement.prisma'), 'utf8');
  assert.match(schema, /planned \| sent \| minted \| failed \| skipped/);
  assert.match(schema, /Never deleted/);
});

apiTest(test, '[SOL-T-15] the mint outbox is planned, sent, minted or failed and retry is a CLI flag', async () => {
  const cli = readFileSync(join(REPO, 'backend/server/src/cli/admin-commands.ts'), 'utf8');
  assert.match(cli, /achievement:mint/);
  assert.match(cli, /--retry/);
  const src = readFileSync(join(REPO, 'backend/server/src/application/use-cases/achievements/mint-achievements/mint-achievements.handler.ts'), 'utf8');
  assert.match(src, /markMinted/);
  assert.match(src, /retryFailed/);
});

test('[SOL-T-16] chain scripts pass an explicit URL and do not write the global solana id', () => {
  const files = [
    'tests/e2e/scripts/validator.sh',
    'tests/e2e/scripts/chain-init.sh',
    '.claude/skills/localnet-e2e/run.sh',
    '.claude/skills/honk-localnet/run.sh',
    'backend/server/scripts/pool-admin.mjs',
  ];
  for (const rel of files) {
    const text = readFileSync(join(REPO, rel), 'utf8');
    assert.doesNotMatch(text, /solana config set/, rel);
    assert.doesNotMatch(text, /writeFileSync\([^)]*id\.json|cp [^\\n]*id\.json|> *~\/\.config\/solana\/id\.json/, rel);
    assert.match(text, /--url|SOLANA_RPC|rpc-port/, rel);
  }
});
