import { Injectable } from '@nestjs/common';
import { clip, type EditorJobRecord, type JobEventType } from '../../domain/editor/editor-job.js';
import type { ProviderId } from '../../domain/editor/llm-providers.js';
import { EditorJobRepositoryPort } from '../ports/editor/editor-job.repository.port.js';
import { JobTokenPort } from '../ports/editor/job-token.port.js';
import { LlmProviderPort, type LlmToolResult, type LlmTurn } from '../ports/editor/llm-provider.port.js';
import { McpClientPort } from '../ports/editor/mcp-client.port.js';
import { ClockPort } from '../ports/shared/clock.port.js';
import { GameSettingsService } from './game-settings.service.js';

/** a tool result handed back to the model is clipped here (an entity file is ≤ 64 KB, the format reference a few) */
const MAX_TOOL_RESULT = 100_000;

export type AgentOutcome = { status: 'done'; text: string } | { status: 'failed'; error: string };

/**
 * One AI editor job, start to end: a capability token for the job → the MCP (its `entity-editor` prompt is the system prompt, its tools the model's
 * tools) → the model's turns. Each turn's text, tool calls and results and its token usage become events the chat polls. It stops on the model's end,
 * a refusal, the output limit, the step limit (`editor_max_steps`) or the abort signal (cancel / timeout – thrown to the runner). The model is asked
 * to check before it saves; if it saves an unchecked source the MCP still validates it, and the event records `unchecked`.
 */
@Injectable()
export class EditorAgentService {
  constructor(
    private readonly llm: LlmProviderPort,
    private readonly mcp: McpClientPort,
    private readonly tokens: JobTokenPort,
    private readonly jobs: EditorJobRepositoryPort,
    private readonly settings: GameSettingsService,
    private readonly clock: ClockPort,
  ) {}

  async run(job: EditorJobRecord, signal: AbortSignal): Promise<AgentOutcome> {
    const knobs = await this.settings.current();
    const session = await this.mcp.connect(await this.tokens.sign({ jobId: job.id, wallet: job.wallet, entityId: job.entityId }));
    try {
      const system = await session.getPrompt(job.entityId ? { entityId: job.entityId } : {});
      const tools = await session.listTools();
      const model = this.llm.open({ provider: job.provider as ProviderId, model: job.model, system, tools, maxOutputTokens: knobs.editorMaxOutputTokens, signal, job: { prompt: job.prompt, entityId: job.entityId } });
      const checked = new Set<string>();
      let turn = await model.send(userMessage(job)), steps = 1, last = '';
      for (;;) {
        signal.throwIfAborted();
        await this.record(job.id, turn);
        if (turn.text) last = turn.text;
        if (turn.stop === 'refusal') return { status: 'failed', error: turn.detail ?? 'the model declined the request' };
        if (turn.stop === 'error') return { status: 'failed', error: turn.detail ?? 'the provider failed' };
        if (turn.stop === 'max_tokens') return { status: 'failed', error: 'the model hit its output limit (editor_max_output_tokens)' };
        if (turn.stop !== 'tool' || !turn.toolCalls.length) return { status: 'done', text: last };
        if (steps >= knobs.editorMaxSteps) return { status: 'failed', error: `the step limit (${knobs.editorMaxSteps} model turns) was reached` };
        const results: LlmToolResult[] = [];
        for (const call of turn.toolCalls) {
          signal.throwIfAborted();
          const source = typeof call.input['source'] === 'string' ? call.input['source'] : null;
          const unchecked = call.name === 'save_draft' && source !== null && !checked.has(source);
          await this.event(job.id, 'tool_call', { name: call.name, summary: summarize(call.input), ok: true, ...(unchecked ? { unchecked: true } : {}) });
          const r = await session.callTool(call.name, call.input);
          if (call.name === 'check_entity' && source !== null && !r.isError && okJson(r.text)) checked.add(source);
          await this.event(job.id, 'tool_result', { name: call.name, summary: clip(r.text.replace(/\s+/g, ' '), 300), ok: !r.isError });
          results.push({ id: call.id, content: clip(r.text, MAX_TOOL_RESULT), isError: r.isError });
        }
        turn = await model.sendToolResults(results);
        steps++;
      }
    } finally {
      await session.close().catch(() => undefined);
    }
  }

  private async record(jobId: string, turn: LlmTurn): Promise<void> {
    if (turn.usage.in || turn.usage.out) {
      await this.jobs.addUsage(jobId, turn.usage.in, turn.usage.out);
      await this.event(jobId, 'usage', { in: turn.usage.in, out: turn.usage.out });
    }
    if (turn.text.trim()) await this.event(jobId, 'text', { text: clip(turn.text) });
  }

  private event(jobId: string, type: JobEventType, payload: Record<string, unknown>) {
    return this.jobs.appendEvent(jobId, type, payload, this.clock.now());
  }
}

/** what the model is asked: the editor's words plus which entity they are about */
export function userMessage(job: Pick<EditorJobRecord, 'prompt' | 'entityId'>): string {
  return `${job.prompt}\n\n(${job.entityId ? `entity: ${job.entityId} – read it with get_entity first` : 'no entity selected: create a new one, or ask which entity to change'}; check_entity before save_draft)`;
}

/** a tool call's arguments as one short line for the chat (a source is shown by its size, never in full) */
export function summarize(input: Record<string, unknown>): string {
  return clip(Object.entries(input).map(([k, v]) => (typeof v === 'string' && v.length > 80 ? `${k}: (${v.length} chars)` : `${k}: ${JSON.stringify(v)}`)).join(', '), 200);
}

const okJson = (text: string): boolean => { try { return (JSON.parse(text) as { ok?: unknown }).ok === true; } catch { return false; } };
