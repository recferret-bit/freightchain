/* Unhandled crashes for the landing, whitepaper, pitch deck, lobby, and game.
   Posted to our API, which sends one `$exception`. No posthog-js, no console hook.
   Nothing runs at import: no fetch, no localStorage. file:// and headless (no location) stay silent. */

import { anonId } from './analytics.js';
import { API_BASE } from './hosts.js';

const SURFACES = new Set(['landing', 'whitepaper', 'pitchdeck', 'lobby', 'game']);
const PER_PAGE = 3;
const RELEASE = /^[0-9a-f]{7,40}$/;
const EXTENSION = /^(chrome|moz|safari-web)-extension:/i;
const SCRIPT_ERROR = /^Script error\.?$/;
const NOISE = /ResizeObserver loop|^AbortError$/;
const V8 = /^\s*at (?:async )?(?:(.*?) \()?((?:https?:|file:|\/)[^ :]+):(\d+):(\d+)\)?$/;
const FF = /^(.*?)@((?:https?:|file:|\/)[^ :]+):(\d+):(\d+)$/;
const BASE58 = /[1-9A-HJ-NP-Za-km-z]{40,}/g;

let hooked = false;
let disabled = false;
let sent = 0;
const seen = new Set();

function live() {
  if (typeof location === 'undefined' || location.protocol === 'file:') return false;
  return typeof addEventListener === 'function';
}

function scrub(value) {
  return String(value ?? '').replace(/https?:\/\/\S+/g, (url) => url.split('?')[0]).replace(BASE58, '[redacted]').replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, 200);
}

/** Youngest frame first, at most eight. Extension frames are dropped. */
export function framesFromStack(stack) {
  const out = [];
  if (typeof stack !== 'string') return out;
  for (const line of stack.split('\n')) {
    const match = V8.exec(line) || FF.exec(line);
    if (!match) continue;
    const filename = scrub(match[2]);
    if (!filename || EXTENSION.test(filename)) continue;
    out.push({ function: scrub(match[1] || '?') || '?', filename, lineno: Number(match[3]), colno: Number(match[4]) });
    if (out.length === 8) break;
  }
  return out;
}

/** Null when the error is noise or has already been reported this page. */
export function buildReport(name, value, stack, filename, lineno, colno) {
  const type = scrub(name).slice(0, 80) || 'Error';
  const message = scrub(value);
  if (SCRIPT_ERROR.test(message) || SCRIPT_ERROR.test(type) || NOISE.test(message) || NOISE.test(type)) return null;
  if (filename && EXTENSION.test(filename)) return null;
  let frames = framesFromStack(stack);
  if (!frames.length && filename && !EXTENSION.test(String(filename))) {
    frames = [{ function: '?', filename: scrub(filename), lineno: lineno >>> 0, colno: colno >>> 0 }];
  }
  const top = frames[0];
  const key = `${type}\n${top ? top.filename : ''}\n${top ? top.lineno : message}`;
  if (seen.has(key) || sent >= PER_PAGE) return null;
  seen.add(key);
  sent += 1;
  return { name: type, value: message || type, frames };
}

/**
 * One hook per document. `credentials: 'omit'` for the pitch deck (no player cookie).
 * `release` is a git sha when the page was built with one; otherwise null.
 */
export function watchCrashes(surface, opt) {
  if (hooked || !SURFACES.has(surface) || !live()) return;
  hooked = true;
  const credentials = opt?.credentials === 'omit' ? 'omit' : 'include';
  const release = typeof opt?.release === 'string' && RELEASE.test(opt.release) ? opt.release : null;
  const post = (name, value, stack, filename, lineno, colno) => {
    if (disabled) return;
    const report = buildReport(name, value, stack, filename, lineno, colno);
    if (!report) return;
    let body = '';
    try { body = JSON.stringify({ anon_id: anonId(), surface, release, ...report }); }
    catch { return; }
    try {
      void fetch(`${API_BASE}/api/client-error`, { credentials, keepalive: true, method: 'POST', headers: { 'content-type': 'application/json' }, body })
        .then(async (res) => {
          const json = await res.json().catch(() => null);
          if (res.ok && json && json.enabled === false) disabled = true;
        })
        .catch(() => { /* a crash report must not surface in the UI */ });
    } catch { /* no fetch in this document */ }
  };
  addEventListener('error', (event) => {
    const err = event.error;
    post(err?.name || 'Error', event.message || err?.message || '', err?.stack, event.filename, event.lineno, event.colno);
  });
  addEventListener('unhandledrejection', (event) => {
    const reason = event.reason;
    if (reason instanceof Error) post(reason.name, reason.message, reason.stack);
    else if (typeof reason === 'string') post('UnhandledRejection', reason, '');
    else post('UnhandledRejection', 'non-error rejection', '');
  });
}
