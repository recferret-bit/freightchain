import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:net';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

/* src/http.js as the app reaches it: a real process on a free port (the app's callbacks are not needed – only static tools are called) */
const HTTP = fileURLToPath(new URL('../src/http.js', import.meta.url)), TOKEN = 'test-token-0123456789abcdef';
const freePort = () => new Promise(r => { const s = createServer().listen(0, () => { const { port } = s.address(); s.close(() => r(port)); }); });
const port = await freePort(), BASE = `http://127.0.0.1:${port}`;
const proc = spawn(process.execPath, [HTTP], { env: { ...process.env, EDITOR_MCP_PORT: String(port), EDITOR_MCP_TOKEN: TOKEN, FC_APP_URL: 'http://127.0.0.1:9' }, stdio: ['ignore', 'pipe', 'inherit'] });
await new Promise(r => proc.stdout.on('data', d => { if (String(d).includes('listening')) r(); }));
test.after(() => proc.kill());
const post = (path, body, headers = {}) => fetch(BASE + path, { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', authorization: `Bearer ${TOKEN}`, ...headers }, body: typeof body === 'string' ? body : JSON.stringify(body) });

test('the bearer gates everything but /health; a wrong or missing token is 401', async () => {
  assert.equal((await fetch(`${BASE}/health`)).status, 200);
  assert.equal((await post('/spec', { phrase: 'x' }, { authorization: '' })).status, 401);
  assert.equal((await post('/spec', { phrase: 'x' }, { authorization: `Bearer ${TOKEN.slice(0, -1)}x` })).status, 401);
  assert.equal((await post('/nope', {})).status, 404);
});

test('POST only, one message per request, bodies up to 512 KB of JSON', async () => {
  const get = await fetch(`${BASE}/mcp`, { headers: { authorization: `Bearer ${TOKEN}` } });
  assert.deepEqual([get.status, get.headers.get('allow')], [405, 'POST']);
  const batch = await post('/mcp', [{ jsonrpc: '2.0', id: 1, method: 'tools/list' }, { jsonrpc: '2.0', id: 2, method: 'tools/list' }]);
  assert.deepEqual([batch.status, (await batch.json()).error.code], [400, -32600]);
  const empty = await post('/mcp', '');
  assert.deepEqual([empty.status, (await empty.json()).error.code], [400, -32600]);
  const prim = await post('/mcp', '123');
  assert.deepEqual([prim.status, (await prim.json()).error.code], [400, -32600]);
  assert.equal((await post('/mcp', '{not json')).status, 400);
  assert.equal((await post('/mcp', JSON.stringify({ pad: 'x'.repeat(600 * 1024) })).catch(() => ({ status: 413 }))).status, 413);
});

test('the spec gate over HTTP; a real MCP client lists the 7 tools and calls one (no job token: the app-backed tools say so)', async () => {
  assert.equal((await (await post('/spec', { phrase: 'a car with 2 wheels' })).json()).verdict, 'rejected');
  const client = new Client({ name: 'test', version: '1' });
  await client.connect(new StreamableHTTPClientTransport(new URL(`${BASE}/mcp`), { requestInit: { headers: { authorization: `Bearer ${TOKEN}` } } }));
  const tools = (await client.listTools()).tools;
  assert.deepEqual(tools.map(t => t.name).sort(), ['check_entity', 'diff_entity', 'get_entity', 'get_format', 'list_entities', 'save_draft', 'validate_spec']);
  assert.ok(tools.every(t => t.annotations?.openWorldHint === false));
  assert.equal(tools.find(t => t.name === 'save_draft').annotations.destructiveHint, false);   // the HTTP backend appends a revision
  const r = await client.callTool({ name: 'get_entity', arguments: { id: 'cactus' } });
  assert.equal(r.isError, true);
  assert.match(r.content[0].text, /no job token/);
  await client.close();
});

test('EDITOR_MCP_RPS limits a caller; a metadata FC_APP_URL refuses to start', async () => {
  const p = await freePort();
  const child = spawn(process.execPath, [HTTP], { env: { ...process.env, EDITOR_MCP_PORT: String(p), EDITOR_MCP_TOKEN: TOKEN, EDITOR_MCP_RPS: '2', FC_APP_URL: 'http://127.0.0.1:9' }, stdio: ['ignore', 'pipe', 'inherit'] });
  await new Promise(r => child.stdout.on('data', d => { if (String(d).includes('listening')) r(); }));
  const one = () => fetch(`http://127.0.0.1:${p}/spec`, { method: 'POST', headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' }, body: '{"phrase":"x"}' });
  const statuses = [];
  for (let i = 0; i < 3; i++) statuses.push((await one()).status);
  assert.deepEqual(statuses, [200, 200, 429]);
  child.kill();
  for (const url of ['http://169.254.169.254/', 'http://[fd00:ec2::254]/', 'http://[::ffff:169.254.169.254]/']) {
    const bad = spawnSync(process.execPath, [HTTP], { env: { ...process.env, EDITOR_MCP_TOKEN: TOKEN, FC_APP_URL: url }, encoding: 'utf8' });
    assert.equal(bad.status, 2, url);
  }
});

test('a short EDITOR_MCP_TOKEN refuses to start', () => {
  const r = spawnSync(process.execPath, [HTTP], { env: { ...process.env, EDITOR_MCP_TOKEN: 'short' }, encoding: 'utf8' });
  assert.equal(r.status, 2);
});
