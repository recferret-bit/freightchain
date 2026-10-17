/* Which job events the chat prints. Queue status, token counts and MCP traces stay off this screen; the server keeps them. */
export function visibleChatLine(ev) {
  const p = ev?.payload ?? {};
  if (ev?.type === 'text') { const text = typeof p.text === 'string' ? p.text.trim() : ''; return text ? { kind: 'ai', text: String(p.text) } : null; }
  if (ev?.type === 'error') return { kind: 'err', text: String(p.message ?? 'failed') };
  if (ev?.type === 'draft') return { kind: 'ok', text: `draft saved: ${p.entityId ?? ''} #${p.seq ?? ''}` };
  return null;
}
