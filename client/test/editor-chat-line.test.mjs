// The editor chat prints the request, the answer, drafts and errors. Tool traces, queue status and token counts stay off the screen.
import test from 'node:test';
import assert from 'node:assert/strict';
import { visibleChatLine } from '../js/editor/chat-line.js';

const line = (type, payload) => visibleChatLine({ type, payload });

test('the chat keeps the answer, a draft and an error', () => {
  assert.deepEqual(line('text', { text: 'the cab is longer' }), { kind: 'ai', text: 'the cab is longer' });
  assert.deepEqual(line('draft', { entityId: 'freighter', seq: 4 }), { kind: 'ok', text: 'draft saved: freighter #4' });
  assert.deepEqual(line('error', { message: 'the step limit was reached' }), { kind: 'err', text: 'the step limit was reached' });
  assert.deepEqual(line('error', {}), { kind: 'err', text: 'failed' });
});

test('queue status, token counts and MCP traces are not shown', () => {
  for (const ev of [
    ['status', { status: 'queued' }],
    ['status', { status: 'running' }],
    ['usage', { in: 1092, out: 58 }],
    ['tool_call', { name: 'get_entity', summary: 'id: "freighter"' }],
    ['tool_result', { name: 'get_entity', summary: '{ "id": "freighter" }', ok: true }],
    ['done', { status: 'done' }],
    ['text', { text: '' }],
    ['text', { text: '   ' }],
  ]) assert.equal(line(ev[0], ev[1]), null, ev[0]);
});
