import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { z } from 'zod';
import { McpSdkClientAdapter, mcpBaseUrl, toolText } from '../../../../src/infrastructure/mcp/mcp-sdk.client.adapter.js';
import type { EnvService } from '../../../../src/infrastructure/config/env.service.js';
import { ServiceUnavailableError } from '../../../../src/domain/shared/errors.js';

/* A real Streamable-HTTP MCP server in-process (stateless, like mcp/src/http.js), on a local port – no network beyond loopback. */
const TOKEN = 't'.repeat(30);
let server: Server, url = '';
const seen: { auth?: string; job?: string }[] = [];
const body = (req: IncomingMessage) => new Promise<unknown>((res) => { let s = ''; req.on('data', (c) => (s += c)); req.on('end', () => res(s ? JSON.parse(s) : undefined)); });

beforeAll(async () => {
  server = createServer(async (req, res) => {
    seen.push({ auth: req.headers.authorization, job: req.headers['x-fc-job'] as string | undefined });
    if (req.headers.authorization !== `Bearer ${TOKEN}`) { res.writeHead(401).end(); return; }
    if (req.url === '/spec') { const b = (await body(req)) as { phrase: string }; res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(/2 wheels/.test(b.phrase) ? { verdict: 'rejected', kind: 'car', errors: ['car wheels must be 4; got 2'] } : { verdict: 'not_a_spec' })); return; }
    const mcp = new McpServer({ name: 'test', version: '1' });
    mcp.registerTool('zeta', { description: 'Z', inputSchema: { id: z.string() } }, async ({ id }) => ({ content: [{ type: 'text', text: `zeta ${id}` }] }));
    mcp.registerTool('alpha', { description: 'A', inputSchema: {} }, async () => ({ isError: true, content: [{ type: 'text', text: 'nope' }] }));
    mcp.registerPrompt('entity-editor', { argsSchema: { entityId: z.string().optional() } }, ({ entityId }) => ({ messages: [{ role: 'user', content: { type: 'text', text: `SYSTEM for ${entityId ?? 'none'}` } }] }));
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    res.on('close', () => { void transport.close(); void mcp.close(); });
    await mcp.connect(transport);
    await transport.handleRequest(req, res, await body(req));
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => new Promise<void>((r) => server.close(() => r())));

const adapter = (token: string | null = TOKEN) => new McpSdkClientAdapter({ editorMcpToken: token ?? undefined, editorMcpUrl: url } as unknown as EnvService);

describe('McpSdkClientAdapter', () => {
  it('connects with the bearer and the job token on every request; tools sorted by name; the prompt; tool results with their error flag', async () => {
    const s = await adapter().connect('JOB-TOKEN');
    expect((await s.listTools()).map((t) => t.name)).toEqual(['alpha', 'zeta']);
    expect(await s.getPrompt({ entityId: 'cactus' })).toBe('SYSTEM for cactus');
    expect(await s.callTool('zeta', { id: 'x' })).toEqual({ text: 'zeta x', isError: false });
    expect(await s.callTool('alpha', {})).toEqual({ text: 'nope', isError: true });
    await s.close();
    expect(seen.length).toBeGreaterThan(3);
    expect(seen.every((r) => r.auth === `Bearer ${TOKEN}`)).toBe(true);
    expect(seen.filter((r) => r.job).every((r) => r.job === 'JOB-TOKEN')).toBe(true);
  });

  it('spec(): the skill gate over POST /spec', async () => {
    expect(await adapter().spec('a car with 2 wheels')).toEqual({ verdict: 'rejected', kind: 'car', errors: ['car wheels must be 4; got 2'] });
    expect((await adapter().spec('taller')).verdict).toBe('not_a_spec');
  });

  it('redirects cannot forward bridge credentials, and initialization respects cancellation', async () => {
    const redirect = createServer((_req, res) => { res.writeHead(307, { location: url + '/spec' }); res.end(); });
    await new Promise<void>(resolve => redirect.listen(0, '127.0.0.1', resolve));
    const bridge = new McpSdkClientAdapter({ editorMcpToken: TOKEN, editorMcpUrl: `http://127.0.0.1:${(redirect.address() as AddressInfo).port}` } as EnvService);
    const before = seen.length;
    try { await expect(bridge.spec('x')).rejects.toBeInstanceOf(ServiceUnavailableError); await expect(bridge.connect('job-secret')).rejects.toBeInstanceOf(ServiceUnavailableError); expect(seen.length).toBe(before); }
    finally { await new Promise<void>(resolve => redirect.close(() => resolve())); }
    const abort = new AbortController(); abort.abort();
    await expect(adapter().connect('job-secret', abort.signal)).rejects.toBeDefined();
  });

  it('off without EDITOR_MCP_TOKEN; a wrong token or an unreachable MCP is a 503', async () => {
    expect(adapter(null).configured).toBe(false);
    await expect(adapter(null).spec('x')).rejects.toBeInstanceOf(ServiceUnavailableError);
    await expect(adapter('w'.repeat(30)).spec('x')).rejects.toBeInstanceOf(ServiceUnavailableError);
    await expect(new McpSdkClientAdapter({ editorMcpToken: TOKEN, editorMcpUrl: 'http://127.0.0.1:1' } as unknown as EnvService).connect('j')).rejects.toBeInstanceOf(ServiceUnavailableError);
    expect(toolText({ content: [{ type: 'text', text: 'a' }, { type: 'image' }, { type: 'text', text: 'b' }] })).toEqual({ text: 'a\nb', isError: false });
    expect(() => mcpBaseUrl('http://169.254.169.254/', false)).toThrow(ServiceUnavailableError);
    expect(() => mcpBaseUrl('http://evil.example/mcp', true)).toThrow(ServiceUnavailableError);
    expect(mcpBaseUrl('http://mcp:3100/ignored', true).origin).toBe('http://mcp:3100');
  });
});
