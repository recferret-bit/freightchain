import { createServer } from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { buildServer, specVerdict } from './server.js';
import { HttpBackend } from './backend.js';
import { createLimiter } from './rate-limit.js';

/* The MCP for the editor bridge: Streamable HTTP, stateless (a fresh server per request), on the internal network only.
   Every request needs `Authorization: Bearer $EDITOR_MCP_TOKEN` (the app's), and the tools act for the job named by `x-fc-job`
   (the app's short-lived capability token – the MCP passes it back to the app untouched; it never sees a wallet key or an AI key).
     EDITOR_MCP_PORT (3100) · EDITOR_MCP_TOKEN (required, ≥ 24 chars) · FC_APP_URL (http://app:3000) */
const PORT = +(process.env.EDITOR_MCP_PORT ?? 3100), TOKEN = process.env.EDITOR_MCP_TOKEN ?? '', RPS = Math.max(1, +(process.env.EDITOR_MCP_RPS ?? 40) || 40);
if (!Number.isSafeInteger(RPS) || RPS > 1000) { console.error('EDITOR_MCP_RPS must be an integer from 1 to 1000'); process.exit(2); }
function appOrigin(raw) {
  let u;
  try { u = new URL(raw); } catch { console.error('FC_APP_URL is not a URL'); process.exit(2); }
  const h = u.hostname;
  if ((u.protocol !== 'http:' && u.protocol !== 'https:') || u.username || u.password || h === '0.0.0.0' || h === '[::]' || h === 'metadata.google.internal' || h === '100.100.100.200' || h === '[fd00:ec2::254]' || h.startsWith('169.254.') || h.includes('a9fe:a9fe')) {
    console.error('FC_APP_URL must be http(s) with no credentials, and not a metadata address'); process.exit(2);
  }
  return u.origin;
}
const APP = appOrigin(process.env.FC_APP_URL ?? 'http://app:3000');
if (TOKEN.length < 24) { console.error('EDITOR_MCP_TOKEN must be set (24+ characters)'); process.exit(2); }
const limiter = createLimiter({ url: process.env.REDIS_URL, token: TOKEN, rps: RPS, production: process.env.NODE_ENV === 'production' });
const authed = h => { const want = Buffer.from(`Bearer ${TOKEN}`), got = Buffer.from(String(h ?? '')); return got.length === want.length && timingSafeEqual(got, want); };
class HttpError extends Error { constructor(status, message) { super(message); this.status = status; } }
const body = req => new Promise((res, rej) => {
  let n = 0, refused = false; const parts = [];
  req.on('data', c => { if (refused) return; n += c.length; if (n > 512 * 1024) { refused = true; parts.length = 0; rej(new HttpError(413, 'body over 512 KB')); } else parts.push(c); });
  req.on('end', () => { if (refused) return; try { res(parts.length ? JSON.parse(Buffer.concat(parts).toString('utf8')) : undefined); } catch { rej(new HttpError(400, 'body is not JSON')); } });
  req.on('error', rej);
});
const send = (res, code, v, headers = {}) => { if (res.writableEnded || res.destroyed) return; res.writeHead(code, { 'content-type': 'application/json', ...headers }); res.end(JSON.stringify(v)); };
const rpcError = (code, message) => ({ jsonrpc: '2.0', error: { code, message }, id: null });
const log = (msg, extra = {}) => console.log(JSON.stringify({ msg, ...extra }));   // never headers: they carry the bearer and the job token

const http = createServer(async (req, res) => {
  try {
    // This service has no browser clients. Reject browser origins and unrecognised Host values before any parsing or tool work.
    if (req.headers.origin !== undefined) return send(res, 403, { error: 'browser origins are not accepted' });
    let hostname; try { hostname = new URL(`http://${req.headers.host}`).hostname; } catch { /* refused below */ }
    if (!['mcp', 'localhost', '127.0.0.1', '[::1]'].includes(hostname)) return send(res, 403, { error: 'host is not allowed' });
    if (req.url === '/health') { const ok = await limiter.ready(); return send(res, ok ? 200 : 503, { ok }); }
    if (!await limiter.allowed(req.socket.remoteAddress ?? 'unknown')) return send(res, 429, { error: 'rate limited' }, { 'retry-after': '1' });
    if (!authed(req.headers.authorization)) return send(res, 401, { error: 'unauthorized' });
    if (req.method === 'POST' && !/^application\/json(?:\s*;|$)/i.test(req.headers['content-type'] ?? '')) return send(res, 415, { error: 'JSON required' });
    if (req.url === '/spec' && req.method === 'POST') { const b = await body(req); if (typeof b?.phrase !== 'string' || b.phrase.length > 4000) return send(res, 400, { error: 'phrase must be text of at most 4000 characters' }); return send(res, 200, specVerdict(b.phrase)); }   // the bridge's precheck, before any AI tokens
    if (req.url !== '/mcp') return send(res, 404, { error: 'not found' });
    if (req.method !== 'POST') return send(res, 405, rpcError(-32000, 'stateless server: POST only'), { allow: 'POST' });
    const msg = await body(req);
    // one JSON-RPC message per request: a batch of 100 check_entity calls would hold the event loop for half a minute
    if (Array.isArray(msg)) return send(res, 400, rpcError(-32600, 'batches are not accepted – one message per request'));
    if (!msg || typeof msg !== 'object') return send(res, 400, rpcError(-32600, 'expected a JSON-RPC message object'));
    const server = buildServer(new HttpBackend(APP, String(req.headers['x-fc-job'] ?? ''))), transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    res.on('close', () => { transport.close(); server.close(); });
    await server.connect(transport);
    await transport.handleRequest(req, res, msg);
  } catch (e) {
    const status = e instanceof HttpError ? e.status : 500;
    if (status === 500) log('mcp request failed');
    if (!res.headersSent) send(res, status, rpcError(-32603, status === 500 ? 'internal error' : e.message));
  }
});
http.requestTimeout = 30_000; http.headersTimeout = 10_000;   // a slow client never pins a socket for Node's 300 s default
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => { http.close(async () => { await limiter.close(); process.exit(0); }); setTimeout(() => process.exit(0), 2000).unref(); });
http.listen(PORT, process.env.NODE_ENV === 'production' ? '0.0.0.0' : '127.0.0.1', () => log('entity MCP listening', { port: PORT, app: APP }));
