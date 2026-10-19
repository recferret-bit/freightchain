// Real API + PostgreSQL + MCP, separate AI process. Only the shell suite's throwaway wallet/database and scripted provider.
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import nacl from 'tweetnacl';
import bs58 from 'bs58';

const base = process.env.BASE ?? 'http://localhost:3000';
const key = nacl.sign.keyPair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(process.env.EDITOR_KEYPAIR, 'utf8'))));
const wallet = bs58.encode(key.publicKey), [mode, file, workerPid] = process.argv.slice(2);
let cookie = '';
async function api(path, body) {
  const r = await fetch(`${base}/api/editor/${path}`, { method: body === undefined ? 'GET' : 'POST', headers: { 'content-type': 'application/json', 'x-fc-editor': '1', ...(cookie ? { cookie } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  const data = await r.json();
  assert(r.ok, `${path}: HTTP ${r.status} (${data.code ?? ''})`);
  const c = r.headers.getSetCookie(); if (c.length) cookie = c.map(v => v.split(';')[0]).join('; ');
  return data;
}
const challenge = await api('auth/nonce', { wallet });
await api('auth/verify', { wallet, signature: bs58.encode(nacl.sign.detached(new TextEncoder().encode(challenge.message), key.secretKey)) });
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
if (mode === 'queue') {
  const first = await api('jobs', { prompt: 'queue cancellation test', entityId: 'cactus' });
  await delay(1200);
  assert.equal((await api(`jobs/${first.jobId}`)).status, 'queued', 'the API must not execute AI work');
  await api(`jobs/${first.jobId}/cancel`, {});
  assert.equal((await api(`jobs/${first.jobId}`)).status, 'cancelled');
  const next = await api('jobs', { prompt: 'separate worker test', entityId: 'cactus' });
  writeFileSync(file, next.jobId);
  console.log('ok   API keeps work queued without an AI worker and can cancel it');
} else if (mode === 'wait') {
  const id = readFileSync(file, 'utf8');
  let job;
  for (let i = 0; i < 100; i++) {
    job = await api(`jobs/${id}`);
    if (!['queued', 'running'].includes(job.status)) break;
    await delay(300);
  }
  assert.equal(job.status, 'done', `worker job status: ${job.status}`);
  assert(job.resultRevisionId);
  const revision = await api(`revisions/${job.resultRevisionId}`);
  assert.equal(revision.jobId, id);
  assert(revision.source.includes('fake edit: separate worker test'));
  const health = JSON.parse(readFileSync(`/tmp/fc-editor-worker-health-${workerPid}.json`, 'utf8'));
  assert(Date.now() - health.checkedAt < 15000);
  console.log('ok   a separate worker discovers the queued job, saves through real MCP and reports fresh health');
} else throw new Error('expected queue or wait');
