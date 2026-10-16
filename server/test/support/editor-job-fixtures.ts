import { FAKE_CLOCK_START } from './fake-clock.js';
import { EDITOR_TOOLS, type EditorJobRecord } from '../../src/domain/editor/editor-job.js';
import type { ProviderId, ProviderInfo } from '../../src/domain/editor/llm-providers.js';
import { LlmProviderPort, type LlmOpenOptions, type LlmSession, type LlmToolResult, type LlmTurn } from '../../src/application/ports/editor/llm-provider.port.js';
import { McpClientPort, type McpSession, type McpToolResult, type SpecVerdict } from '../../src/application/ports/editor/mcp-client.port.js';
import { JobTokenPort, type JobClaims } from '../../src/application/ports/editor/job-token.port.js';
import { EditorAgentService } from '../../src/application/services/editor-agent.service.js';
import { EditorJobRunnerService } from '../../src/application/services/editor-job-runner.service.js';
import { MemoryEditorJobRepository } from './in-memory/memory-editor-jobs.js';
import { entityContext } from './entity-fixtures.js';
import { unitRules } from './unit-context.js';
import type { RulesConfig } from '../../src/application/ports/config/rules-config.port.js';

export const turn = (over: Partial<LlmTurn> = {}): LlmTurn => ({ text: '', toolCalls: [], stop: 'end', usage: { in: 0, out: 0 }, ...over });

/** a model that answers scripted turns in order and records what it was sent */
export class ScriptedLlm extends LlmProviderPort {
  readonly opened: LlmOpenOptions[] = [];
  readonly sent: (string | readonly LlmToolResult[])[] = [];
  constructor(public turns: (LlmTurn | ((o: LlmOpenOptions) => Promise<LlmTurn>))[] = [], private readonly providers: ProviderInfo[] = [{ id: 'fake', label: 'Fake', models: ['scripted'], default: 'scripted' }], private readonly pref: ProviderId | null = null) { super(); }
  enabled(): ProviderInfo[] { return this.providers; }
  preferred(): ProviderId | null { return this.pref; }
  open(o: LlmOpenOptions): LlmSession {
    this.opened.push(o);
    const next = async () => { const t = this.turns.shift(); if (!t) throw new Error('no scripted turn left'); return typeof t === 'function' ? t(o) : t; };
    return { send: async (text) => { this.sent.push(text); return next(); }, sendToolResults: async (r) => { this.sent.push(r); return next(); } };
  }
}

/** an MCP whose tools answer from a map (name → result), recording the calls */
export class ScriptedMcp extends McpClientPort {
  readonly calls: { name: string; args: Record<string, unknown> }[] = [];
  tokens: string[] = [];
  closed = 0;
  configured = true;
  verdict: SpecVerdict = { verdict: 'not_a_spec' };
  tools = EDITOR_TOOLS.map((name) => ({ name, description: '', inputSchema: {} }));
  constructor(public results: Record<string, McpToolResult> = {}) { super(); }
  async spec(): Promise<SpecVerdict> { return this.verdict; }
  async connect(token: string): Promise<McpSession> {
    this.tokens.push(token);
    return {
      listTools: async () => this.tools,
      getPrompt: async (a) => `SYSTEM ${a.entityId ?? '-'}`,
      callTool: async (name, args) => { this.calls.push({ name, args }); return this.results[name] ?? { text: '{}', isError: false }; },
      close: async () => { this.closed++; },
    };
  }
}

export class PlainJobTokens extends JobTokenPort {
  async sign(c: JobClaims): Promise<string> { return `token:${c.jobId}`; }
  async verify(): Promise<JobClaims | null> { return null; }
}

export function jobContext(rules: RulesConfig = unitRules(), llm = new ScriptedLlm(), mcp = new ScriptedMcp()) {
  const ctx = entityContext(rules);
  const jobs = new MemoryEditorJobRepository(ctx.db);
  const agent = new EditorAgentService(llm, mcp, new PlainJobTokens(), jobs, ctx.settings, ctx.clock);
  const runner = new EditorJobRunnerService(agent, jobs, ctx.settings, ctx.rules, ctx.clock);
  return { ...ctx, jobs, agent, runner, llm, mcp };
}

let n = 0;
export const aJob = (over: Partial<EditorJobRecord> = {}): EditorJobRecord => ({
  id: `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`, wallet: 'W', prompt: 'taller', provider: 'fake', model: 'scripted', entityId: 'cactus', baseRevisionId: null,
  resultRevisionId: null, status: 'queued', error: null, tokensIn: 0, tokensOut: 0, createdAt: new Date(FAKE_CLOCK_START), startedAt: null, finishedAt: null, ...over,
});
