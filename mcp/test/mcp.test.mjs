import test from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, mkdtempSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { buildServer, specVerdict } from '../src/server.js';
import { FileBackend } from '../src/backend.js';
import { SEED } from '../src/paths.js';

async function connect() {
  const dir = mkdtempSync(join(tmpdir(), 'fc-mcp-')); cpSync(SEED, dir, { recursive: true });
  const [a, b] = InMemoryTransport.createLinkedPair(), client = new Client({ name: 'test', version: '1' });
  await Promise.all([buildServer(new FileBackend(dir)).connect(a), client.connect(b)]);
  const call = async (name, args = {}) => { const r = await client.callTool({ name, arguments: args }); return { error: !!r.isError, ...JSON.parse(r.content[0].text) }; };
  return { client, call, dir };
}

test('the spec gate rejects only an impossible car / tree / building', () => {
  assert.equal(specVerdict('a car with 2 wheels').verdict, 'rejected');
  assert.equal(specVerdict('a birch with a leafy canopy').verdict, 'rejected');
  assert.equal(specVerdict('make the cactus arms thicker').verdict, 'not_a_spec');
  assert.equal(specVerdict('a truck with 4 wheels').verdict, 'ok');
});

test('tools: list, read, check, save a valid edit, refuse an invalid one and gameplay keys', async () => {
  const { client, call, dir } = await connect();
  const tools = (await client.listTools()).tools.map(t => t.name).sort();
  assert.deepEqual(tools, ['check_entity', 'diff_entity', 'get_entity', 'get_format', 'list_entities', 'save_draft', 'validate_spec']);
  const list = JSON.parse((await client.callTool({ name: 'list_entities', arguments: { kind: 'vehicle' } })).content[0].text);
  assert.equal(list.length, 7);
  const bush = await call('get_entity', { id: 'bush' });
  assert.equal(bush.gameplayLock.lock.kind, 'bush');
  const wider = bush.source.replace("s: ['s', 's * 0.9', 's']", "s: ['s * 1.2', 's * 0.9', 's * 1.2']");
  const ok = await call('check_entity', { source: wider });
  assert.ok(ok.ok, ok.errors?.join('; ')); assert.ok(ok.summary.sizeXYZ[0] > 2.3);
  const saved = await call('save_draft', { id: 'bush', source: wider, message: 'wider bush' });
  assert.ok(saved.saved); assert.match(readFileSync(join(dir, 'prop', 'bush.js'), 'utf8'), /s \* 1\.2/);
  const hp = await call('save_draft', { id: 'bush', source: wider.replace("debris: 'm',", "debris: 'm', hp: 5,"), message: 'x' });
  assert.ok(hp.error); assert.ok(hp.errors.some(e => /gameplay/.test(e)));
  const code = await call('check_entity', { source: "export default { id: 'x', kind: 'part', v: 1, parts: [{ geo: 'box', s: [1, 1, 1], mat: { color: alert(1) } }] };" });
  assert.equal(code.ok, false);
  const renamed = await call('save_draft', { id: 'rock', source: wider, message: 'x' });
  assert.ok(renamed.error);
  const fresh = await call('save_draft', { id: 'water-tower', source: "export default { id: 'water-tower', kind: 'part', v: 1, slots: { m: {} }, parts: [{ geo: 'cyl', tag: 'tank', mat: 'm', s: [2, 3, 2], at: [0, 8, 0] }, { for: 'x', in: [-1.5, 1.5], do: [{ geo: 'box', tag: 'leg', mat: 'm', s: [0.2, 6.5, 0.2], at: ['x', 3.25, 0] }] }] };\n", message: 'new' });
  assert.ok(fresh.saved, JSON.stringify(fresh)); assert.ok(existsSync(join(dir, 'part', 'water-tower.js')));
  const prompt = await client.getPrompt({ name: 'entity-editor', arguments: { entityId: 'sedan', kind: 'vehicle' } });
  assert.match(prompt.messages[0].content.text, /save_draft exactly once/); assert.match(prompt.messages[0].content.text, /car/);
  await client.close();
});
