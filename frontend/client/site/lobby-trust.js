import { el } from './dom.js';

/** The API checks the signed-in wallet; this form never accepts another address or a client token claim. */
export function trustSection({ api, alive = () => true }) {
  const box = el('div', { id: 'sgt-box' }, el('p', { class: 'dim' }, 'Loading Seeker verification…'));
  const note = el('p', { class: 'msg dim', id: 'sgt-msg', role: 'status' });
  let busy = false;
  const paint = state => {
    if (!alive()) return;
    box.replaceChildren(
      el('p', {}, state.claimed ? `Seeker trust shortcut received. Current trust: ${state.trustScore}/100.` : `Current trust: ${state.trustScore}/100. Verify your Seeker Genesis Token to receive the one-time trust shortcut to 100.`),
      el('p', { class: 'dim' }, 'One shortcut per Seeker device and wallet. Later ride penalties still apply. This checks ownership on mainnet without sending a transaction; rides and payments stay on devnet.'),
      state.claimed ? el('p', { class: 'good' }, 'VERIFIED') : state.enabled ? el('button', { type: 'button', id: 'sgt-verify', disabled: busy, onclick: async () => {
        if (busy) return;
        busy = true; paint(state); note.textContent = 'Checking ownership…'; note.className = 'msg dim';
        try { const next = await api('me/trust/sgt', {}, { report: false }); if (alive()) { paint(next); note.textContent = 'Seeker ownership verified.'; note.className = 'msg good'; } }
        catch (e) { if (alive()) { note.textContent = e.message; note.className = 'msg bad'; } }
        finally { busy = false; if (alive()) { const button = box.querySelector('button'); if (button) button.disabled = false; } }
      } }, 'VERIFY SEEKER OWNERSHIP') : el('p', { class: 'dim' }, 'Seeker verification is not configured on this server.'));
  };
  api('me/trust/sgt', undefined, { report: false }).then(paint).catch(e => { if (alive()) box.replaceChildren(el('p', { class: 'bad' }, e.message)); });
  return [el('h2', {}, 'SEEKER TRUST'), box, note];
}
