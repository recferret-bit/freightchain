import { createServer } from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { buildServer, specVerdict } from './server.js';
import { HttpBackend } from './backend.js';

/* The MCP for the editor bridge: Streamable HTTP, stateless (a fresh server per request), on the internal network only.
   Every request needs `Authorization: Bearer $EDITOR_MCP_TOKEN` (the app's), and the tools act for the job named by `x-fc-job`
   (the app's short-lived capability token – the MCP passes it back to the app untouched; it never sees a wallet key or an AI key).
     EDITOR_MCP_PORT (3100) · EDITOR_MCP_TOKEN (required, ≥ 24 chars) · FC_APP_URL (http://app:3000) */
const PORT = +(process.env.EDITOR_MCP_PORT ?? 3100), TOKEN = process.env.EDITOR_MCP_TOKEN ?? '', APP = process.env.FC_APP_URL ?? 'http://app:3000';
if (TOKEN.length < 24) { console.error('EDITOR_MCP_TOKEN must be set (24+ characters)'); process.exit(2); }
const authed = h => { const want = Buffer.from(`Bearer ${TOKEN}`), got = Buffer.from(String(h ?? '')); return got.length === want.length && timingSafeEqual(got, want); };
class HttpError extends Error { constructor(status, message) { super(message); this.status = status; } }
const body = req => new Promise((res, rej) => {
  let n = 0; const parts = [];
  req.on('data', c => { n += c.length; if (n > 512 * 1024) { rej(new HttpError(413, 'body over 512 KB')); req.destroy(); } else parts.push(c); });
  req.on('end', () => { try { res(parts.length ? JSON.parse(Buffer.concat(parts).toString('utf8')) : undefined); } catch { rej(new HttpError(400, 'body is not JSON')); } });
  req.on('error', rej);
});
const send = (res, code, v, headers = {}) => { if (res.writableEnded || res.destroyed) return; res.writeHead(code, { 'content-type': 'application/json', ...headers }); res.end(JSON.stringify(v)); };
const rpcError = (code, message) => ({ jsonrpc: '2.0', error: { code, message }, id: null });
const log = (msg, extra = {}) => console.log(JSON.stringify({ msg, ...extra }));   // never headers: they carry the bearer and the job token

const http = createServer(async (req, res) => {
  try {
    if (req.url === '/health') return send(res, 200, { ok: true });
    if (!authed(req.headers.authorization)) return send(res, 401, { error: 'unauthorized' });
    if (req.url === '/spec' && req.method === 'POST') { const b = await body(req); return send(res, 200, specVerdict(b?.phrase ?? '')); }   // the bridge's precheck, before any AI tokens
    if (req.url !== '/mcp') return send(res, 404, { error: 'not found' });
    if (req.method !== 'POST') return send(res, 405, rpcError(-32000, 'stateless server: POST only'), { allow: 'POST' });
    const msg = await body(req);
    // one JSON-RPC message per request: a batch of 100 check_entity calls would hold the event loop for half a minute
    if (Array.isArray(msg)) return send(res, 400, rpcError(-32600, 'batches are not accepted – one message per request'));
    const server = buildServer(new HttpBackend(APP, String(req.headers['x-fc-job'] ?? ''))), transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    res.on('close', () => { transport.close(); server.close(); });
    await server.connect(transport);
    await transport.handleRequest(req, res, msg);
  } catch (e) {
    const status = e instanceof HttpError ? e.status : 500;
    if (status === 500) log('mcp request failed', { url: req.url, error: String(e?.message ?? e).slice(0, 200) });
    if (!res.headersSent) send(res, status, rpcError(-32603, status === 500 ? 'internal error' : e.message));
  }
});
http.requestTimeout = 30_000; http.headersTimeout = 10_000;   // a slow client never pins a socket for Node's 300 s default
http.listen(PORT, () => log('entity MCP listening', { port: PORT, app: APP }));
