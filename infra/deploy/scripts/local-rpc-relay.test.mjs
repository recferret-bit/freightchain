import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PassThrough } from 'node:stream';
import { request } from 'node:http';
import { once } from 'node:events';
import { createInterface } from 'node:readline';
import { serve, attach } from './local-rpc-relay.mjs';

test('relay preserves real RPC response bodies and correlates concurrent reversed replies', async () => {
  const input = new PassThrough(), output = new PassThrough();
  const relay = serve({ input, output, port: 0 }); await once(relay.server, 'listening');
  const url = `http://127.0.0.1:${relay.server.address().port}`;
  const requests = [];
  createInterface({ input: output }).on('line', line => {
    requests.push(JSON.parse(line));
    if (requests.length === 2) for (const r of requests.reverse()) input.write(JSON.stringify({ id: r.id, status: 200, body: r.body }) + '\n');
  });
  try {
    const replies = await Promise.all(['first', 'second'].map(body => fetch(url, { method: 'POST', body }).then(r => r.text())));
    assert.deepEqual(replies, ['first', 'second']);
    assert.equal((await fetch(url)).status, 405);
  } finally { relay.close(); }
});
test('a missing transport response is a 503, never a synthetic RPC success', async () => {
  const relay = serve({ input: new PassThrough(), output: new PassThrough(), port: 0, timeout: 20 }); await once(relay.server, 'listening');
  try { assert.equal((await fetch(`http://127.0.0.1:${relay.server.address().port}`, { method: 'POST', body: '{}' })).status, 503); } finally { relay.close(); }
});
test('host relay refuses external endpoints before spawning Docker', () => {
  for (const url of ['https://api.devnet.solana.com', 'http://localhost:8899', 'http://127.0.0.1:8899/other']) assert.throws(() => attach('unused', url), /explicit local validator/);
});

test('an interrupted upload cannot crash the relay', async () => {
  const relay = serve({ input: new PassThrough(), output: new PassThrough(), port: 0, timeout: 20 }); await once(relay.server, 'listening');
  const url = `http://127.0.0.1:${relay.server.address().port}`;
  try {
    await new Promise(resolve => {
      const req = request(url, { method: 'POST', headers: { 'content-length': '1000' } });
      req.on('error', () => {}); req.write('partial');
      setTimeout(() => { req.destroy(); resolve(); }, 20);
    });
    assert.equal((await fetch(url, { method: 'POST', body: '{}' })).status, 503);
  } finally { relay.close(); }
});
