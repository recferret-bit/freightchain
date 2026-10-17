import { API_BASE } from './hosts.js';

/* Bare play.html is the real EASY ride: a signed-in wallet orders level 1, a stranger gets an anonymous session first.
   ?ride, ?watch and ?sim skip this (a tool sim stays local). Headless boot has no location and skips it too.
   The guest wallet is a throwaway public key. Achievements on it do not merge into a later sign-in. */

async function call(path, body) {
  const r = await fetch(`${API_BASE}/api/${path}`, {
    credentials: 'include',
    signal: AbortSignal.timeout(8000),
    method: body ? 'POST' : 'GET',
    headers: body ? { 'content-type': 'application/json' } : { accept: 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const payload = await r.json().catch(() => ({}));
  return { ok: r.ok, status: r.status, body: payload };
}

/** 'go' after the redirect, 'fail' when the ride could not be ordered, false when this page is not the product entry. */
export async function beginEasyEntry() {
  if (typeof location === 'undefined') return false;
  const q = new URL(location.href).searchParams;
  if (q.has('ride') || q.has('watch') || q.has('sim')) return false;
  try {
    const me = await call('me');
    if (me.status === 401) {
      const guest = await call('auth/guest', {});
      if (!guest.ok) return 'fail';
    } else if (!me.ok) return 'fail';
    let id = me.ok ? me.body?.readyFreeRide?.id : null;
    if (typeof id !== 'string' || !id) {
      const tutorial = me.ok ? !me.body?.tutorialPassed : true;
      const ride = await call('rides', { tier: 'free', level: 1, tutorial, assist: true });
      id = ride.body?.id;
      if (!ride.ok || typeof id !== 'string' || !id) return 'fail';
    }
    const next = new URL(location.href);
    next.searchParams.delete('offline');
    next.searchParams.delete('sim');
    next.searchParams.set('ride', id);
    location.replace(`${next.pathname}${next.search}`);
    return 'go';
  } catch {
    return 'fail';
  }
}
