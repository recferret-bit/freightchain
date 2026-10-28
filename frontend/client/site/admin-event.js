/* The admin page's EVENT TOP-20 tab: the Pre-season $500 event's review and payout record (docs/plan/DEVNET_PRESEASON.md §14-§15).
   GET /api/admin/event → candidates (top 35 + disqualified) with the checklist data, the prize table, the lock and the recorded USDC payouts.
   Every change is signed by the admin wallet for exactly that change (ctx.signAt('event/challenge', intent) → POST event/<route> with the signature) and audited.
   No server key sends money: the admin pays from the event wallet by hand and records the transaction here. Server text goes in with textContent only. */

const usd = c => `$${(c / 100).toFixed(2)}`;
const GEO = { eligible: 'eligible', play_only_no_prizes: 'play only – no prizes', no_prizes: 'no prizes (list / unknown)' };
const BASE58_SIG = /^[1-9A-HJ-NP-Za-km-z]{87,88}$/;

/** "10000, 7000,…" → [10000, 7000, …]; throws a sentence for what the server would refuse, so the wallet is never asked to sign nonsense. */
export function parseTable(text) {
  const cents = text.split(/[\s,]+/).filter(Boolean).map(Number);
  if (!cents.length || cents.length > 20 || cents.some(c => !Number.isInteger(c) || c < 0 || c > 100_000_000)) throw new Error('Prize table: 1 to 20 whole, non-negative US cents separated by commas.');
  return cents;
}

export async function eventTab(ctx) {
  const { api, el, view, signAt, time, wallet } = ctx;
  const e = await api('event');
  const say = el('p', { class: 'msg dim', id: 'ev-note', role: 'status' });
  const tell = (text, cls = 'dim') => { say.textContent = text; say.className = `msg ${cls}`; };
  const reload = async text => { await eventTab(ctx); const n = document.getElementById('ev-note'); if (n && text) { n.textContent = text; n.className = 'msg good'; } };
  /** one click = one signature: the button is off while the wallet asks and the request runs */
  const act = (btn, what, route, intent, body) => async () => {
    btn.disabled = true;
    try {
      tell(`Sign in your wallet: ${what}…`);
      const signature = await signAt('event/challenge', intent);
      await api(`event/${route}`, { ...body, signature });
    } catch (err) { tell(err.message, 'bad'); btn.disabled = false; return; }
    try { await reload(`${what} – done.`); } catch { tell('Saved; reloading failed – press REFRESH.', 'bad'); }
  };

  const table = el('input', { id: 'ev-table', value: e.prizeTableCents.join(','), 'aria-label': 'prize table in US cents', disabled: e.locked, spellcheck: 'false' });
  const tableBtn = el('button', { type: 'button', id: 'ev-table-save', disabled: e.locked }, 'SIGN & SAVE TABLE');
  tableBtn.onclick = () => {
    let cents; try { cents = parseTable(table.value); } catch (err) { tell(err.message, 'bad'); return; }
    return act(tableBtn, 'set the prize table', 'prize-table', { action: 'event_prize_table', cents }, { cents })();
  };
  const lockBtn = el('button', { type: 'button', id: 'ev-lock', class: 'reject', disabled: e.locked || !e.appealsEnd || e.now < e.appealsEnd, title: e.appealsEnd ? `allowed from ${time(e.appealsEnd)}` : 'set event_review_end_utc and event_appeals_end_utc first' }, e.locked ? 'LOCKED' : 'LOCK FINAL LIST');
  lockBtn.onclick = act(lockBtn, 'lock the final list', 'lock', { action: 'event_lock' }, {});

  const flagBtn = (label, on, run) => { const b = el('button', { type: 'button', disabled: e.locked, class: on ? 'reject' : '' }, label); b.onclick = () => run(b); return b; };
  const row = c => {
    const note = el('input', { value: c.note ?? '', maxlength: '300', placeholder: 'note (signed, audited)', 'aria-label': `note for ${c.wallet}`, disabled: e.locked });
    const review = (b, dq, prize) => { const n = note.value.trim() || null; return act(b, `review ${c.wallet.slice(0, 4)}…`, 'review', { action: 'event_review', wallet: c.wallet, disqualified: dq, prizeEligible: prize, note: n }, { wallet: c.wallet, disqualified: dq, prizeEligible: prize, note: n })(); };
    const sanctionsBtn = el('button', { type: 'button', 'data-act': 'sanctions' }, 'CHECK SANCTIONS');
    sanctionsBtn.onclick = act(sanctionsBtn, `sanctions check of ${c.wallet.slice(0, 4)}…`, 'sanctions', { action: 'event_sanctions', wallet: c.wallet }, { wallet: c.wallet });
    const sanc = c.sanctionsClean === null ? 'not checked' : `${c.sanctionsClean ? 'clean' : 'NOT CLEAN'} · ${time(c.sanctionsCheckedAt)}${c.sanctionsFresh ? ' · fresh' : ' · stale'}`;
    return el('tr', { class: c.disqualified ? 'dq' : '', 'data-wallet': c.wallet },
      el('td', {}, c.disqualified ? '–' : c.rank), el('td', {}, c.place ?? '–'), el('td', {}, el('a', { href: `#players/${c.wallet}`, class: 'mono', title: c.wallet }, wallet(c.wallet))),
      el('td', {}, `${(c.bps / 100).toFixed(2)}%`), el('td', {}, c.amountCents ? usd(c.amountCents) : '–'),
      el('td', {}, `${c.country ?? '?'}${c.region ? `-${c.region}` : ''} · ${GEO[c.geoAccess]}${c.prizeEligibleOverride === false ? ' · prize removed' : ''}`),
      el('td', { class: c.trustBlocked ? 'bad' : '' }, `${c.trustScore}${c.trustBlocked ? ' (blocks payout)' : ''}`),
      el('td', {}, el('a', { href: `#ride/${c.rideId}`, class: 'mono' }, c.rideId.slice(0, 8)), c.attempts > 1 ? ` · ${c.attempts} attempts!` : ''),
      el('td', { class: 'mono dim' }, c.ipPrefixHmac.join(' ') || '–', c.ipOverlaps.length ? el('div', { class: 'warn' }, `shares a subnet with ${c.ipOverlaps.map(wallet).join(', ')}`) : ''),
      el('td', {}, sanc, el('br'), sanctionsBtn),
      el('td', {}, note, el('br'),
        flagBtn(c.disqualified ? 'RESTORE' : 'DISQUALIFY', c.disqualified === false, b => review(b, !c.disqualified, c.prizeEligibleOverride)),
        flagBtn(c.prizeEligibleOverride === false ? 'RESTORE PRIZE' : 'REMOVE PRIZE', c.prizeEligibleOverride !== false, b => review(b, c.disqualified, c.prizeEligibleOverride === false ? null : false))));
  };

  const winnerRow = w => {
    const tx = el('input', { placeholder: 'USDC transfer signature (base58)', 'aria-label': `transaction of place ${w.place}`, spellcheck: 'false', autocomplete: 'off' });
    const go = el('button', { type: 'button', 'data-act': 'payout' }, 'RECORD PAYOUT');
    go.onclick = () => {
      const txSignature = tx.value.trim();
      if (!BASE58_SIG.test(txSignature)) { tell('That is not a Solana transaction signature (87–88 base58 characters).', 'bad'); return; }
      return act(go, `record the payout of place ${w.place}`, 'payouts', { action: 'event_payout', wallet: w.wallet, txSignature }, { wallet: w.wallet, txSignature })();
    };
    return el('tr', { 'data-wallet': w.wallet }, el('td', {}, w.place), el('td', {}, el('a', { href: `#players/${w.wallet}`, class: 'mono', title: w.wallet }, wallet(w.wallet))), el('td', {}, usd(w.amountCents)), el('td', {}, `${(w.bps / 100).toFixed(2)}%`),
      el('td', {}, w.txSignature ? el('a', { href: `https://solscan.io/tx/${w.txSignature}`, target: '_blank', rel: 'noopener', class: 'good mono' }, `✓ ${w.txSignature.slice(0, 12)}… ${w.paidAt ? time(w.paidAt) : ''}`) : el('span', {}, tx, ' ', go)));
  };
  const th = list => el('thead', {}, el('tr', {}, ...list.map(h => el('th', {}, h))));

  view.replaceChildren(
    el('h2', {}, `EVENT TOP-20 · ${e.phase.toUpperCase()}${e.locked ? ' · LOCKED' : ''}`),
    el('p', { class: 'dim' }, `Public preliminary table: ${e.reviewEnd ? time(e.reviewEnd) : 'not scheduled'} · appeals close and the list may be locked: ${e.appealsEnd ? time(e.appealsEnd) : 'not scheduled'} (settings tab). Prizes now: ${usd(e.paidCents)} · stays with the organizer: ${usd(e.organizerCents)}.`),
    el('div', { class: 'card filters' }, el('label', {}, 'Prize table (US cents, place 1 first)', ' ', table), tableBtn, lockBtn, el('small', { class: 'dim' }, e.tableIsDefault ? 'default table' : 'custom table', ' · frozen by the lock')),
    el('h2', {}, `CANDIDATES · ${e.candidates.length}`),
    el('p', { class: 'dim' }, 'Checklist per wallet: geo (RU/BY stay on the board without a prize), Trust below 50 blocks only the payout, shared sign-in subnet (≤ 1 prize place per cluster with a second signal), the ride (ride-audit), a sanctions check under 24 h old before the payout is recorded.'),
    e.candidates.length ? el('div', { class: 'card', style: 'padding:6px 8px;overflow-x:auto' }, el('table', { class: 'dense', id: 'ev-candidates' }, th(['rank', 'place', 'wallet', 'clean', 'prize', 'geo', 'trust', 'ride', 'subnet HMAC', 'sanctions', 'review']), el('tbody', {}, e.candidates.map(row))))
      : el('div', { class: 'card empty' }, 'No verified event attempt yet.'),
    el('h2', {}, `FINAL LIST · ${e.winners.length}`),
    e.locked ? el('div', { class: 'card', style: 'padding:6px 8px;overflow-x:auto' }, el('table', { class: 'dense', id: 'ev-winners' }, th(['place', 'wallet', 'USDC', 'clean', 'transaction']), el('tbody', {}, e.winners.map(winnerRow))))
      : el('div', { class: 'card empty' }, 'Not locked yet. Payouts are recorded here after the lock: pay by hand from the event wallet, then paste each transaction signature.'),
    say);
}
