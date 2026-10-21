/* Pointer and key trace for one minigame event. Taken into a batch's aux.mg and then cleared.
   Moves are thinned so one event stays well under the 64 KB batch budget. */

const rec = { e: null, seq: 0, ptr: [], keys: [], hit: [], focus: [], t0: 0 };

export function traceReset(eventId, now = performance.now()) {
  rec.e = eventId; rec.ptr = []; rec.keys = []; rec.hit = []; rec.focus = []; rec.t0 = now;
}

const dt = now => Math.max(0, Math.round((now - rec.t0) * 1000));

export function tracePointer(e, kind, now = performance.now()) {
  if (!rec.e) return;
  if (kind === 'm' && rec.ptr.length > 700) return;
  const x = e.offsetX, y = e.offsetY, w = e.target?.clientWidth || 1, h = e.target?.clientHeight || 1;
  rec.ptr.push([dt(now), Math.round((x / w) * 1000) / 1000, Math.round((y / h) * 1000) / 1000, kind]);
}

export function traceHit(targetId, rx, ry, now = performance.now()) {
  if (!rec.e) return;
  rec.hit.push([dt(now), targetId, Math.round(rx * 1000) / 1000, Math.round(ry * 1000) / 1000]);
}

export function traceKey(e, now = performance.now()) {
  if (!rec.e) return;
  rec.keys.push([dt(now), e.code, e.type === 'keydown' ? 1 : 0, e.isTrusted ? 1 : 0, e.repeat ? 1 : 0]);
}

export function traceFocus(name, now = performance.now()) {
  if (!rec.e) return;
  rec.focus.push([dt(now), name]);
}

/** Pull the chunk for the next batch. Null when this event recorded nothing. */
export function takeTrace() {
  if (!rec.e || (!rec.ptr.length && !rec.keys.length && !rec.hit.length)) return null;
  const body = { e: rec.e, seq: rec.seq++, ptr: rec.ptr, keys: rec.keys, hit: rec.hit, focus: rec.focus, trusted: { total: rec.keys.length + rec.ptr.length, untrusted: rec.keys.filter(k => !k[3]).length } };
  rec.ptr = []; rec.keys = []; rec.hit = []; rec.focus = [];
  const json = JSON.stringify(body);
  if (json.length > 24000) body.ptr = body.ptr.filter((_, i) => i % 2 === 0);
  return body;
}
