import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { HttpBackend } from '../src/backend.js';

test('an app redirect cannot forward the job capability token to another origin', async t => {
  let leaked = false;
  const target = createServer((_req, res) => { leaked = true; res.end('{}'); });
  await new Promise(resolve => target.listen(0, '127.0.0.1', resolve));
  const source = createServer((_req, res) => { res.writeHead(307, { location: `http://127.0.0.1:${target.address().port}/capture` }); res.end(); });
  await new Promise(resolve => source.listen(0, '127.0.0.1', resolve));
  t.after(async () => { await Promise.all([source, target].map(server => new Promise(resolve => server.close(resolve)))); });
  await assert.rejects(new HttpBackend(`http://127.0.0.1:${source.address().port}`, 'test-job-token').configs());
  assert.equal(leaked, false);
});
