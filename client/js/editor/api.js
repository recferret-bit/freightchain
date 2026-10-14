import { EDITOR_BASE } from '../hosts.js';

/* The editor's API (docs/editor-api.md): same-origin on storybook.<apex>, the host-only fc_editor cookie, x-fc-editor on every unsafe call.
   A problem+json answer becomes an Error carrying its code, status and (for a refused entity) errors / warnings. */
export async function api(path, { method = 'GET', body } = {}) {
  const r = await fetch(`${EDITOR_BASE}/api/editor/${path}`, { method, credentials: 'include', headers: { accept: 'application/json', ...(body !== undefined ? { 'content-type': 'application/json' } : {}), ...(method !== 'GET' ? { 'x-fc-editor': '1' } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await r.text(); let data = null; try { data = text ? JSON.parse(text) : null; } catch { data = { detail: text }; }
  if (!r.ok) { const e = new Error(data?.detail ?? data?.title ?? `HTTP ${r.status}`); Object.assign(e, { status: r.status, code: data?.code, errors: data?.errors ?? [], warnings: data?.warnings ?? [] }); throw e; }
  return data;
}
export const get = path => api(path);
export const post = (path, body = {}) => api(path, { method: 'POST', body });
