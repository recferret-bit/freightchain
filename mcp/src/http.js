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
const body = req => new Promise((res, rej) => { let n = 0; const parts = []; req.on('data', c => { n += c.length; if (n > 512 * 1024) { rej(new Error('too large')); req.destroy(); } else parts.push(c); }); req.on('end', () => { try { res(parts.length ? JSON.parse(Buffer.concat(parts).toString('utf8')) : undefined); } catch (e) { rej(e); } }); req.on('error', rej); });
const send = (res, code, v) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(v)); };

createServer(async (req, res) => {
  try {
    if (req.url === '/health') return send(res, 200, { ok: true });
    if (!authed(req.headers.authorization)) return send(res, 401, { error: 'unauthorized' });
    if (req.url === '/spec' && req.method === 'POST') { const b = await body(req); return send(res, 200, specVerdict(b?.phrase ?? '')); }   // the bridge's precheck, before any AI tokens
    if (req.url !== '/mcp') return send(res, 404, { error: 'not found' });
    if (req.method !== 'POST') return send(res, 405, { jsonrpc: '2.0', error: { code: -32000, message: 'stateless server: POST only' }, id: null });
    const server = buildServer(new HttpBackend(APP, String(req.headers['x-fc-job'] ?? ''))), transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    res.on('close', () => { transport.close(); server.close(); });
    await server.connect(transport);
    await transport.handleRequest(req, res, await body(req));
  } catch (e) { if (!res.headersSent) send(res, 400, { error: e.message }); }
}).listen(PORT, () => console.log(JSON.stringify({ msg: 'entity MCP listening', port: PORT, app: APP })));
