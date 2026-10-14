import type { LlmOpenOptions, LlmSession, LlmToolResult, LlmTurn } from '../../application/ports/editor/llm-provider.port.js';

/* TEST ONLY (NODE_ENV=test, or EDITOR_FAKE_LLM=1 outside production): a scripted "model" that drives a real job through the real MCP tools.
     turn 1: get_entity({ id: <the job's entity> })
     turn 2: the head source with a top-level `note: 'fake edit: <prompt>'` line (replacing one, else after `label:` or `v: 1,`) → check_entity({ source })
     turn 3: ok → save_draft({ id, source, message: 'fake: <prompt>' }); not ok → ends with the errors as text
     turn 4: ends with 'done (fake)' */

const parse = (text: string): Record<string, unknown> => { try { const v = JSON.parse(text) as unknown; return v && typeof v === 'object' ? (v as Record<string, unknown>) : {}; } catch { return {}; } };
const usage = { in: 0, out: 0 };

/** the fake edit itself (exported for its spec) */
export function fakeEdit(source: string, prompt: string): string {
  const note = `  note: 'fake edit: ${prompt.replace(/['"`\\\n\r]/g, '').slice(0, 60)}',`;
  const lines = source.split('\n');
  const existing = lines.findIndex((l) => /^ {2}note:/.test(l));
  if (existing >= 0) { lines[existing] = note; return lines.join('\n'); }
  let at = lines.findIndex((l) => /^ {2}label:/.test(l));
  if (at < 0) at = lines.findIndex((l) => /^\s*v: 1,/.test(l) || / v: 1,/.test(l));
  if (at < 0) return source;
  lines.splice(at + 1, 0, note);
  return lines.join('\n');
}

export class FakeLlmSession implements LlmSession {
  private step = 0;
  private source = '';

  constructor(private readonly o: LlmOpenOptions) {}

  send(_text: string): Promise<LlmTurn> {
    this.step = 1;
    const id = this.o.job?.entityId;
    if (!id) return Promise.resolve({ text: 'The fake model needs an entity to edit.', toolCalls: [], stop: 'end', usage });
    return Promise.resolve({ text: `Reading ${id}.`, toolCalls: [{ id: 'fake-1', name: 'get_entity', input: { id } }], stop: 'tool', usage });
  }

  sendToolResults(results: readonly LlmToolResult[]): Promise<LlmTurn> {
    if (this.o.signal.aborted) return Promise.reject(new Error('aborted'));
    const r = results[0], prompt = this.o.job?.prompt ?? '', id = this.o.job?.entityId ?? '';
    this.step++;
    if (this.step === 2) {
      const raw = parse(r?.content ?? '')['source'], src = typeof raw === 'string' ? raw : '';
      if (r?.isError || !src) return Promise.resolve({ text: `Could not read ${id}.`, toolCalls: [], stop: 'end', usage });
      this.source = fakeEdit(src, prompt);
      return Promise.resolve({ text: 'Checking the edit.', toolCalls: [{ id: 'fake-2', name: 'check_entity', input: { source: this.source } }], stop: 'tool', usage });
    }
    if (this.step === 3) {
      const check = parse(r?.content ?? '');
      if (r?.isError || check['ok'] !== true) return Promise.resolve({ text: `The edit does not validate: ${JSON.stringify(check['errors'] ?? r?.content ?? '')}`, toolCalls: [], stop: 'end', usage });
      return Promise.resolve({ text: 'Saving a draft.', toolCalls: [{ id: 'fake-3', name: 'save_draft', input: { id, source: this.source, message: `fake: ${prompt.slice(0, 40)}` } }], stop: 'tool', usage });
    }
    return Promise.resolve({ text: 'done (fake)', toolCalls: [], stop: 'end', usage });
  }
}
