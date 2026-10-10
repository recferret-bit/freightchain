/* A 64-hex sketch of this browser. Easy to spoof; the server also counts the request IP.
   No imports: the offline page and nothing else. `crypto` and `screen` are not lint globals. */
export async function fingerprint() {
  const c = globalThis.crypto;
  if (!c?.subtle) throw new Error('no crypto');
  const scr = globalThis.screen;
  let pic = '';
  try {
    const canvas = document.createElement('canvas');
    canvas.width = 16; canvas.height = 16;
    const g = canvas.getContext('2d');
    if (g) {
      g.fillStyle = '#c84'; g.fillRect(0, 0, 16, 16);
      g.fillStyle = '#123'; g.font = '8px sans-serif'; g.fillText('fc', 1, 12);
      pic = canvas.toDataURL().slice(0, 80);
    }
  } catch { pic = ''; }
  const parts = [
    navigator.userAgent, navigator.language,
    Intl.DateTimeFormat().resolvedOptions().timeZone || '',
    String(scr?.width ?? 0), String(scr?.height ?? 0), String(scr?.colorDepth ?? 0),
    String(navigator.hardwareConcurrency ?? 0), pic,
  ].join('\n');
  const digest = await c.subtle.digest('SHA-256', new TextEncoder().encode(parts));
  return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('');
}
