/* Replay transport. The watch panel paints these; the driving sim is not in here. */
export const SPEEDS = [0.5, 1, 2, 4];
export const CAMERAS = ['cabin', 'chase', 'hood'];
export const SEEK_STEP = 10;

export function clampTime(t, end) {
  const max = Number.isFinite(end) ? Math.max(0, end) : 0;
  const n = Number(t);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(max, n));
}

export function seekBy(t, delta, end) {
  return clampTime(t + delta, end);
}

export function nextCamera(current) {
  const i = CAMERAS.indexOf(current);
  return CAMERAS[(i < 0 ? 0 : i + 1) % CAMERAS.length];
}

export function hoverSeconds(ratio, end) {
  const r = Number.isFinite(ratio) ? Math.max(0, Math.min(1, ratio)) : 0;
  return clampTime(r * (Number.isFinite(end) ? end : 0), end);
}

export function formatClock(t) {
  const s = Math.max(0, Math.floor(Number(t) || 0));
  const m = Math.floor(s / 60);
  const h = Math.floor(m / 60);
  const pad = (n) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m % 60)}:${pad(s % 60)}` : `${pad(m)}:${pad(s % 60)}`;
}

/** Share link keeps the watch id and pins the playback second. */
export function shareUrl(href, seconds) {
  const base = typeof location !== 'undefined' ? location.href : 'http://localhost/play.html';
  const url = new URL(href || base, base);
  url.searchParams.set('t', String(Math.max(0, Math.floor(Number(seconds) || 0))));
  return `${url.pathname}${url.search}${url.hash}`;
}

export function deepLinkSeconds(search) {
  const raw = new URLSearchParams(search || '').get('t');
  if (raw == null || raw === '' || !Number.isFinite(+raw) || +raw < 0) return null;
  return Math.floor(+raw);
}

/** Damage where hull drops, honk lines, and a minigame when the phone flag is set. Start is always there. */
export function timelineMarks(samples, events, end) {
  const marks = [{ kind: 'start', t: 0 }];
  let prev = null;
  for (const row of samples || []) {
    if (!row || row.length < 8) continue;
    const hull = row[7];
    if (prev != null && hull < prev - 0.4) marks.push({ kind: 'damage', t: row[0] });
    if ((row[13] & 4096) !== 0) marks.push({ kind: 'minigame', t: row[0] });
    prev = hull;
  }
  for (const event of events || []) if (event?.kind === 'honk') marks.push({ kind: 'honk', t: event.replayT ?? event.at ?? 0 });
  if (Number.isFinite(end) && end > 0) marks.push({ kind: 'finish', t: end });
  return marks;
}

/** Speed (m/s) and hull for the strip under the timeline. At most `n` points. */
export function chartSeries(samples, n = 80) {
  const rows = (samples || []).filter((row) => row && row.length > 7);
  if (!rows.length) return [];
  const step = Math.max(1, Math.ceil(rows.length / n));
  const out = [];
  for (let i = 0; i < rows.length; i += step) out.push({ t: rows[i][0], v: rows[i][4] || 0, hull: rows[i][7] });
  const last = rows[rows.length - 1];
  if (out[out.length - 1]?.t !== last[0]) out.push({ t: last[0], v: last[4] || 0, hull: last[7] });
  return out;
}

export function paintChart(canvas, series, at) {
  if (!canvas?.getContext) return;
  const ctx = canvas.getContext('2d');
  const w = canvas.width, h = canvas.height;
  ctx.clearRect(0, 0, w, h);
  if (!series.length) return;
  const t0 = series[0].t, t1 = Math.max(series[series.length - 1].t, t0 + 1);
  const maxV = Math.max(1, ...series.map((p) => p.v));
  const line = (pick, max, color) => {
    ctx.beginPath();
    ctx.strokeStyle = color;
    series.forEach((p, i) => {
      const x = ((p.t - t0) / (t1 - t0)) * (w - 4) + 2;
      const y = h - 2 - (pick(p) / max) * (h - 6);
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    });
    ctx.stroke();
  };
  line((p) => p.hull, 100, '#7cff7c');
  line((p) => p.v, maxV, '#ffcf5a');
  if (Number.isFinite(at)) {
    const x = ((clampTime(at, t1) - t0) / (t1 - t0)) * (w - 4) + 2;
    ctx.strokeStyle = '#efe6cf';
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, h);
    ctx.stroke();
  }
}

/** Keys that belong to the replay, not the truck. Ignores them while a field is focused. */
export function bindReplayKeys(target, actions) {
  const root = target || (typeof window !== 'undefined' ? window : null);
  if (!root?.addEventListener) return () => {};
  const onKey = (event) => {
    if (event.target?.closest?.('input, textarea')) return;
    const run = {
      Space: () => actions.play(),
      ArrowLeft: () => actions.seek(-SEEK_STEP),
      ArrowRight: () => actions.seek(SEEK_STEP),
      KeyC: () => actions.camera(),
      KeyF: () => actions.fullscreen(),
      KeyM: () => actions.mute(),
    }[event.code];
    if (!run || event.repeat && event.code !== 'Space') return;
    event.preventDefault();
    event.stopPropagation();
    run();
  };
  root.addEventListener('keydown', onKey, true);
  return () => root.removeEventListener('keydown', onKey, true);
}
