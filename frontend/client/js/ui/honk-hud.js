import { TOKEN_SYMBOL } from '../config.js';
import { st } from '../state.js';

/* TEN4 (HONK) HUD component: formats server-supplied honk quote/status and updates the HUD & end-panel rows. */

/** What `ride.honk` says. null = show nothing (free rides, state none, a server that does not send the field). Amounts stay the server's decimal strings. */
export function honkLines(h) {
  if (!h || h.state === 'none') return null;
  const bands = Array.isArray(h.bands) ? h.bands.map(b => `${b.pct}${b.reached ? ' ✓' : ''}`).join(' · ') : '';
  if (h.state === 'preview') return { k: 'Points if this ride verifies', v: `${h.quote} ${TOKEN_SYMBOL}`, k2: bands ? 'Bands' : '', v2: bands };
  if (h.state === 'pending') return { k: 'Held for the verdict', v: `${h.quote} ${TOKEN_SYMBOL}`, k2: 'Credits after 48 hours', v2: '' };
  if (h.state === 'minted') return { k: 'Minted', v: `${h.pays} ${TOKEN_SYMBOL}` };
  if (h.state === 'withheld') return { k: 'Verification did not pass', v: '0', k2: 'A pass would have paid', v2: `${h.quote} ${TOKEN_SYMBOL}` };
  return null;
}

export function paintHonkInto(lineId, moreId, h) {
  const row = document.getElementById(lineId);
  if (!row?.isConnected) return;   // the headless stub invents elements that were never mounted
  const more = document.getElementById(moreId), lines = honkLines(h);
  if (!lines) { row.hidden = true; if (more?.isConnected) more.hidden = true; return; }
  const k = document.getElementById(`${lineId}-k`), v = document.getElementById(`${lineId}-v`);
  if (!k || !v) return;
  k.textContent = lines.k; v.textContent = lines.v; row.hidden = false;
  if (!more?.isConnected) return;
  const on = !!(lines.k2 || lines.v2);
  more.hidden = !on;
  if (!on) return;
  const k2 = document.getElementById(`${moreId}-k`), v2 = document.getElementById(`${moreId}-v`);
  if (k2) k2.textContent = lines.k2 || ''; if (v2) v2.textContent = lines.v2 || '';
}

export function syncHonk() {
  const hud = document.getElementById('honk-hud'), line = document.getElementById('honk-line');
  if (!hud?.isConnected) return;
  hud.hidden = !!st.watch || st.mode !== 'drive' || !line || line.hidden !== false;
}

export function mountHonk() {
  if (typeof document === 'undefined' || !document.body?.append || document.getElementById('honk-hud')?.isConnected) return;
  const line = id => {
    const d = document.createElement('div'); d.id = id; d.hidden = true;
    const s = document.createElement('span'); s.id = `${id}-k`;
    const b = document.createElement('b'); b.id = `${id}-v`;
    d.append(s, b); return d;
  };
  const box = document.createElement('div');
  box.id = 'honk-hud'; box.hidden = true; box.setAttribute?.('aria-label', TOKEN_SYMBOL);
  box.append(line('honk-line'), line('honk-line-more'));
  document.body.append(box);
}
