/* Unhandled crashes for every page (see crash-page.js). Posted to our API, which sends one `$exception`.
   No posthog-js, no console hook. Nothing runs at import: no fetch, no localStorage. file:// and headless stay silent. */

import { anonId } from './analytics.js';
import { API_BASE } from './hosts.js';

const SURFACES = new Set(['landing', 'whitepaper', 'pitchdeck', 'lobby', 'game', 'admin', 'blink', 'receipt', 'viewer']);
const PER_PAGE = 3;
const RELEASE = /^[0-9a-f]{7,40}$/;
const EXTENSION = /^(chrome|moz|safari-web)-extension:/i;
const SCRIPT_ERROR = /^Script error\.?$/;
const NOISE = /ResizeObserver loop|^AbortError$/;
const UNCAUGHT = /^Uncaught\s+([A-Za-z_$][\w$]*)\s*:\s*([\s\S]*)$/;
// `user:pass@` is allowed before the host so the frame still parses; scrub() removes it. An `@` later in the path (three.js) is not userinfo.
const V8 = /^\s*at (?:async )?(?:(.*?) \()?((?:https?:\/\/(?:[^/\s@]+@)?|(?:chrome|moz|safari-web)-extension:|file:|\/)[^ :]+):(\d+):(\d+)\)?$/;
const FF = /^(.*?)@((?:https?:\/\/(?:[^/\s@]+@)?|(?:chrome|moz|safari-web)-extension:|file:|\/)[^ :]+):(\d+):(\d+)$/;
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
  return String(value ?? '').replace(/https?:\/\/\S+/g, (url) => url.replace(/^(https?:\/\/)[^/\s@]*@/i, '$1').split('?')[0]).replace(BASE58, '[redacted]').replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, 200);
}

function clamp(value, max) {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 0) return 0;
  return n > max ? max : n;
}

/** Chrome prefixes `error` messages with `Uncaught TypeError:`. Rejections do not. Peel it, or the same bug becomes two issues. */
function peel(name, value) {
  let type = scrub(name).slice(0, 80) || 'Error';
  let message = scrub(value);
  const match = UNCAUGHT.exec(message);
  if (match && (type === 'Error' || type === match[1])) {
    type = scrub(match[1]).slice(0, 80) || 'Error';
    message = scrub(match[2]);
  }
  return { type, message };
}

function matchLine(line) {
  const text = line.trim(); // a Firefox frame can end in CR; `$` would miss it
  return V8.exec(text) || FF.exec(text);
}

/** Youngest frame first, at most eight. Extension frames are dropped. */
export function framesFromStack(stack) {
  const out = [];
  if (typeof stack !== 'string') return out;
  for (const line of stack.split('\n')) {
    const match = matchLine(line);
    if (!match) continue;
    const filename = scrub(match[2]);
    if (!filename || EXTENSION.test(filename)) continue;
    out.push({ function: scrub(match[1] || '?') || '?', filename, lineno: clamp(match[3], 10_000_000), colno: clamp(match[4], 1_000_000) });
    if (out.length === 8) break;
  }
  return out;
}

/** True when every parsed frame was an extension. An empty stack is a real stackless error, not this. */
function extensionOnlyStack(stack) {
  if (typeof stack !== 'string') return false;
  let saw = false;
  for (const line of stack.split('\n')) {
    const match = matchLine(line);
    if (!match) continue;
    saw = true;
    const filename = scrub(match[2]);
    if (filename && !EXTENSION.test(filename)) return false;
  }
  return saw;
}

/** Null when the error is noise or has already been reported this page. */
export function buildReport(name, value, stack, filename, lineno, colno) {
  const { type, message } = peel(name, value);
  if (SCRIPT_ERROR.test(message) || SCRIPT_ERROR.test(type) || NOISE.test(message) || NOISE.test(type)) return null;
  const file = filename ? scrub(filename) : '';
  if (file && EXTENSION.test(file)) return null;
  let frames = framesFromStack(stack);
  // Dropping extension frames and then sending `frames: []` would look like an in-app error with no stack.
  if (!frames.length && extensionOnlyStack(stack) && (!file || EXTENSION.test(file))) return null;
  if (!frames.length && file) frames = [{ function: '?', filename: file, lineno: clamp(lineno, 10_000_000), colno: clamp(colno, 1_000_000) }];
  const top = frames[0];
  const key = `${type}\n${top ? top.filename : ''}\n${top ? top.lineno : message}`;
  if (seen.has(key) || sent >= PER_PAGE) return null;
  seen.add(key);
  sent += 1;
  return { name: type, value: message || type, frames };
}

/** The admin page answers the API on its own host, and that host is not a CORS origin of api.<apex>. Every other page uses API_BASE. */
export function clientErrorUrl(hostname, apiBase) {
  return String(hostname || '').toLowerCase().startsWith('admin.') ? '/api/client-error' : `${apiBase}/api/client-error`;
}

/**
 * One hook per document. `credentials: 'omit'` for the pitch deck and the model viewer (no player cookie).
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
      void fetch(clientErrorUrl(location.hostname, API_BASE), { credentials, keepalive: true, method: 'POST', headers: { 'content-type': 'application/json' }, body })
        .then(async (res) => {
          const json = await res.json().catch(() => null);
          if (res.ok && json && json.enabled === false) disabled = true;
        })
        .catch(() => { /* a crash report must not surface in the UI */ });
    } catch { /* no fetch in this document */ }
  };
  addEventListener('error', (event) => {
    // A failed image is a plain Event, not an ErrorEvent. The listener is bubble-phase; this still ignores it if that ever changes.
    const ErrorEventRef = globalThis.ErrorEvent;
    if (typeof ErrorEventRef === 'function' && !(event instanceof ErrorEventRef)) return;
    const err = event.error;
    const fromError = err && typeof err.message === 'string' ? err.message : '';
    post(err?.name || 'Error', fromError || event.message || '', err?.stack, event.filename, event.lineno, event.colno);
  });
  addEventListener('unhandledrejection', (event) => {
    const reason = event.reason;
    if (reason instanceof Error) post(reason.name, reason.message, reason.stack);
    else if (typeof reason === 'string') post('UnhandledRejection', reason, '');
    else post('UnhandledRejection', 'non-error rejection', '');
  });
}
