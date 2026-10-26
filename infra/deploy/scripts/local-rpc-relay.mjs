// Test transport only: JSON-RPC travels over Docker attach, so test containers need no outbound network.
import { createServer } from 'node:http';
import { createInterface } from 'node:readline';
import { spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';

export function serve({ input = process.stdin, output = process.stdout, port = 8899, timeout = 15000 } = {}) {
  const pending = new Map(); let next = 0;
  const lines = createInterface({ input });
  lines.on('line', line => {
    let reply; try { reply = JSON.parse(line); } catch { return; }
    const request = pending.get(reply.id); if (!request) return;
    pending.delete(reply.id); clearTimeout(request.timer);
    request.response.writeHead(reply.status === 200 ? 200 : 503, { 'content-type': 'application/json' });
    request.response.end(reply.body);
  });
  const server = createServer(async (request, response) => {
    if (request.method !== 'POST' || request.url !== '/') { response.writeHead(405); response.end(); return; }
    let body = '', size = 0;
    try {
      for await (const chunk of request) {
        size += chunk.length;
        if (size > 2 * 1024 * 1024) { response.writeHead(413); response.end(); return; }
        body += chunk;
      }
    } catch { response.destroy(); return; }
    const id = ++next;
    const timer = setTimeout(() => { pending.delete(id); response.writeHead(503); response.end('relay timeout'); }, timeout);
    pending.set(id, { response, timer });
    response.once('close', () => { clearTimeout(timer); pending.delete(id); });
    output.write(JSON.stringify({ id, body }) + '\n');
  });
  server.listen(port, '0.0.0.0');
  return { server, close() { lines.close(); for (const { response, timer } of pending.values()) { clearTimeout(timer); response.destroy(); } pending.clear(); server.close(); } };
}

export function attach(container, rpc) {
  const url = new URL(rpc);
  if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || url.pathname !== '/') throw new Error('relay requires an explicit local validator URL');
  const child = spawn('docker', ['attach', '--sig-proxy=false', container], { stdio: ['pipe', 'pipe', 'inherit'] });
  createInterface({ input: child.stdout }).on('line', async line => {
    let request; try { request = JSON.parse(line); } catch { return; }
    let status = 503, body = 'local validator unavailable';
    try {
      const response = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: request.body, signal: AbortSignal.timeout(12000) });
      status = response.status; body = await response.text();
    } catch { /* A real outage stays an outage; never fabricate a chain result. */ }
    if (!child.stdin.destroyed) child.stdin.write(JSON.stringify({ id: request.id, status, body }) + '\n');
  });
  child.on('exit', code => { process.exitCode = code || 0; });
  for (const signal of ['SIGTERM', 'SIGINT']) process.once(signal, () => child.kill('SIGTERM'));
  return child;
}
if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  if (process.argv[2] === 'serve') serve();
  else if (process.argv[2] === 'attach') attach(process.argv[3], process.argv[4]);
  else throw new Error('expected serve or attach');
}
