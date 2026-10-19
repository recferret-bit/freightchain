// A fault-injecting JSON-RPC proxy for the localnet chaos scenario (scripts/e2e-localnet-chaos.mjs): the SERVER talks to the validator through it, the scenario
// itself (balances, the chain clock, pool-admin) talks to the validator directly, so only the server's view of the chain is made flaky.
//   const proxy = await startFaultProxy({ target: RPC });   proxy.url → give to the server as SOLANA_RPC
//   proxy.fault({ method: 'sendTransaction', mode: 'blackhole', times: 2 })   → returns a handle; handle.hits counts how often it fired; handle.off() removes it
//   proxy.clear()  ·  proxy.stats()  ({ forwarded: { method: n }, injected: { 'method:mode': n } })  ·  await proxy.close()
// Modes (a rule matches a JSON-RPC `method` – '*' = every method, a whole provider outage –, optionally `when(params)`; the first live rule wins; `times` = how often it fires, default forever):
//   error          the node answers a JSON-RPC error (default code -32005 "node is unhealthy"; `message` / `code` override) – a refusing / rate-limited provider
//   http           the HTTP status `status` (default 429) with no JSON-RPC body
//   blackhole      sendTransaction only: NOT forwarded, answers with the real signature of the bytes – a dropped transaction the sender believes was accepted
//   lose-response  forwarded (it lands), but the caller gets an error – a timeout after the cluster took it
//   delay          forwarded after `ms`
// Nothing here knows the program; it is a plain pass-through plus rules. The websocket is not proxied (point SOLANA_WS at a closed port to silence it).
import http from 'node:http';
import bs58 from 'bs58';

const signatureOf = b64 => { const raw = Buffer.from(b64, 'base64'); return bs58.encode(raw.subarray(1, 65)); };   // 1 byte of signature count (< 128), then the first signature

export async function startFaultProxy({ target, port = 0 }) {
  let rules = [];
  const forwarded = {}, injected = {};
  const bump = (m, k) => { m[k] = (m[k] ?? 0) + 1; };

  const forward = async body => {
    bump(forwarded, body.method);
    const r = await fetch(target, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    return { status: r.status, json: await r.json() };
  };
  const rpcError = (id, code, message) => ({ jsonrpc: '2.0', id, error: { code, message } });

  const handleOne = async body => {
    const rule = rules.find(r => (r.method === '*' || r.method === body.method) && (r.times === undefined || r.hits < r.times) && (!r.when || r.when(body.params ?? [])));
    if (!rule) return forward(body).then(x => ({ status: x.status, json: x.json }));
    rule.hits++; bump(injected, `${body.method}:${rule.mode}`);
    switch (rule.mode) {
      case 'error': return { status: 200, json: rpcError(body.id, rule.code ?? -32005, rule.message ?? 'Node is unhealthy (fault proxy)') };
      case 'http': return { status: rule.status ?? 429, json: null };
      case 'blackhole': return { status: 200, json: { jsonrpc: '2.0', id: body.id, result: signatureOf(body.params[0]) } };
      case 'lose-response': await forward(body); return { status: 200, json: rpcError(body.id, -32003, 'Transaction timed out (fault proxy: it was forwarded)') };
      case 'delay': await new Promise(r => setTimeout(r, rule.ms ?? 1000)); return forward(body);
      default: throw new Error(`unknown fault mode ${rule.mode}`);
    }
  };

  const server = http.createServer(async (req, res) => {
    if (req.method === 'OPTIONS') { res.writeHead(204, { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*' }); return res.end(); }
    const chunks = []; for await (const c of req) chunks.push(c);
    try {
      const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      if (Array.isArray(body)) {
        const out = await Promise.all(body.map(handleOne));
        res.writeHead(200, { 'content-type': 'application/json' }); return res.end(JSON.stringify(out.map(o => o.json)));
      }
      const out = await handleOne(body);
      if (out.json === null) { res.writeHead(out.status); return res.end('fault proxy'); }
      res.writeHead(out.status, { 'content-type': 'application/json', 'access-control-allow-origin': '*' }); res.end(JSON.stringify(out.json));
    } catch (e) { res.writeHead(502); res.end(String(e?.message ?? e)); }
  });
  await new Promise(r => server.listen(port, '127.0.0.1', r));
  const url = `http://127.0.0.1:${server.address().port}`;

  return {
    url,
    fault(rule) { const r = { hits: 0, ...rule }; rules.push(r); return Object.assign(r, { off: () => { rules = rules.filter(x => x !== r); } }); },
    clear() { rules = []; },
    stats: () => ({ forwarded: { ...forwarded }, injected: { ...injected } }),
    close: () => new Promise(r => { server.closeAllConnections?.(); server.close(r); }),
  };
}

// standalone smoke:  node scripts/localnet-fault-proxy.mjs <target rpc>   – forwards getHealth through the proxy, then through an `error` rule
if (import.meta.url === `file://${process.argv[1]}`) {
  const target = process.argv[2]; if (!target) { console.error('usage: node scripts/localnet-fault-proxy.mjs <rpc url>'); process.exit(2); }
  const p = await startFaultProxy({ target });
  const call = async method => (await (await fetch(p.url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params: [] }) })).json());
  const a = await call('getHealth'); p.fault({ method: 'getHealth', mode: 'error', times: 1 }); const b = await call('getHealth'); const c = await call('getHealth');
  console.log(JSON.stringify({ passthrough: a.result, injected: b.error?.message, afterTimes: c.result, stats: p.stats() }));
  await p.close();
  process.exit(a.result === 'ok' && b.error && c.result === 'ok' ? 0 : 1);
}
