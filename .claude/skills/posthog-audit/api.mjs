import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
export const keyPath = join(root, 'deploy/secrets/posthog-personal.key');

/** The personal key. Throws without echoing the file. */
export function loadKey() {
  let ignored = false;
  try {
    execFileSync('git', ['check-ignore', '-q', 'deploy/secrets/posthog-personal.key'], { cwd: root });
    ignored = true;
  } catch { /* not ignored */ }
  if (!ignored) throw new Error('deploy/secrets/posthog-personal.key is not gitignored');
  let raw = '';
  try { raw = readFileSync(keyPath, 'utf8').trim(); } catch { raw = ''; }
  if (!raw.startsWith('phx_') || raw.length < 20) throw new Error('personal key missing or not a phx_ key at deploy/secrets/posthog-personal.key');
  return raw;
}

export function redact(text) {
  return String(text).replace(/phc_[A-Za-z0-9]+/g, 'phc_REDACTED').replace(/phx_[A-Za-z0-9]+/g, 'phx_REDACTED');
}

export async function api(path, { method = 'GET', body } = {}) {
  const key = loadKey();
  const res = await fetch(`https://eu.posthog.com${path}`, {
    method,
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(redact(`${method} ${path} → ${res.status} ${text.slice(0, 400)}`));
  return text ? JSON.parse(text) : {};
}

/** `next` may be a path or an absolute URL. Follow it on this host either way. */
function nextPath(next) {
  if (!next) return '';
  const url = new URL(next, 'https://eu.posthog.com');
  return `${url.pathname}${url.search}`;
}

export async function listInsights() {
  const out = [];
  let path = '/api/projects/297915/insights/?limit=100';
  while (path) {
    const page = await api(path);
    out.push(...(page.results ?? []));
    path = nextPath(page.next);
  }
  return out;
}
