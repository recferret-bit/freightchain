import { API_BASE, SITE_BASE } from './hosts.js';
import { fingerprint } from './fingerprint.js';

/* Counted free runs on play.html?offline=1 only. Bare play.html stays the prototype (no fetch here).
   Imports hosts + fingerprint only, so the menu can import this without a cycle. */
export const offlineRide = { on: false };

export function offlineWanted() {
  if (typeof location === 'undefined') return false;
  return new URL(location.href).searchParams.get('offline') === '1';
}

export const connectHref = () => `${SITE_BASE}/`;
export const lobbyHref = () => `${SITE_BASE}/lobby.html`;

async function read(res) {
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(body.detail || 'offline check failed'), { status: res.status, code: body.code ?? null });
  return body;
}

export async function offlineStatus() {
  const id = await fingerprint();
  return read(await fetch(`${API_BASE}/api/offline-rides?fingerprint=${id}`, { credentials: 'include' }));
}

export async function claimOfflineRide() {
  const id = await fingerprint();
  return read(await fetch(`${API_BASE}/api/offline-rides`, {
    method: 'POST', credentials: 'include', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ fingerprint: id }),
  }));
}
