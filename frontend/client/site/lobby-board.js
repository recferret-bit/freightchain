import { api } from './wallet.js';
import { $, el } from './dom.js';
import { pillGroupEl } from './ui.js';
import { left, sol } from './pools.js';
import { store } from '../js/util.js';
import { formatDriver, seedSns, seedSnsBatch } from './sns.js';

/* The lobby's LEADERBOARD tab. The shell (the board buttons, the blurb, the table) is painted before the request and
   stays put while a board, a level, a sort or a page is loading — replacing the whole view with "Loading…" flashed. */
const BOARDS = [['round', 'THIS ROUND'], ['all', 'ALL TIME'], ['free', 'FREE RIDES']];
const OFF = new Set(['round', 'all']);   // paid boards are switched off for now; the buttons stay so the row does not move
const TIERS = [['1h', '1H', 'standard shift']];
const COLS = [['distance', 'KM', 'total distance'], ['time', 'TIME', 'time driven'], ['hull', 'HULL', 'hull left at the end of the furthest shift'], ['rides', 'SHIFTS', 'finished shifts']];
const SORT_NOTE = { time: 'time driven', hull: 'hull left', rides: 'shifts' };
const FALLBACK = ['', 'EASY', 'MEDIUM', 'HARD'];
const B = { sort: 'distance', page: 1, req: 0, failed: false, verifiedOnly: null, prizeRanks: 20, endsAt: 0, shown: '' };
const cache = new Map();
let C = null;

const key = () => `${C.S.board}|${C.S.board === 'free' ? C.S.boardLevel : C.S.boardTier}|${B.sort}|${B.page}`;
const levels = () => C.S.tiers?.tiers.find((t) => t.id === 'free')?.levels ?? [];
const levelName = (n) => levels().find((l) => l.level === n)?.name ?? FALLBACK[n] ?? '';
const setBusy = (on) => $('board-table')?.setAttribute('aria-busy', on ? 'true' : 'false');

export function renderBoard(view, ctx) {
  C = ctx;
  const seg = el('div', { class: 'seg', role: 'group', 'aria-label': 'Board' }, ...BOARDS.map(([id, label]) => el('button', { type: 'button', 'data-board': id, disabled: OFF.has(id) || undefined, title: OFF.has(id) ? 'Temporarily unavailable' : undefined, onclick: () => pickBoard(id) }, label)));
  view.replaceChildren(
    el('h2', {}, 'LEADERBOARD'),
    el('div', { id: 'board-head' }, seg),
    el('p', { class: 'dim', id: 'board-blurb' }),
    el('p', { class: 'dim' }, 'Top 100, 25 a page. Click KM, TIME, HULL or SHIFTS to sort. HULL is what the truck had left at the end of its furthest shift.'),
    el('div', { class: 'place', id: 'board-standing', hidden: true }),
    el('div', { class: 'card', id: 'board-table' }, el('div', { class: 'board-scroll' }, el('table', {}, el('thead', { id: 'board-cols' }), el('tbody', { id: 'board-body' })))),
    el('div', { class: 'pager', id: 'board-pager', hidden: true }));
  syncHead();
  if (!paintCached()) placeholder();
  void load();
}

function pickBoard(id) {
  if (OFF.has(id) || (C.S.board === id && !B.failed)) return;
  C.S.board = id; B.page = 1; refresh();
}
function pickTier(id) {
  if (C.S.boardTier === id && !B.failed) return;
  C.S.boardTier = id; store.set('freightchain.board-tier', id); B.page = 1; refresh();
}
function pickLevel(n) {
  if (C.S.boardLevel === n && !B.failed) return;
  C.S.boardLevel = n; store.set('freightchain.board-level', String(n)); B.page = 1; refresh();
}
function pickSort(sort) {
  if (B.sort === sort && !B.failed) return;
  B.sort = sort; B.page = 1; refresh();
}
function goPage(page) {
  if (page === B.page || page < 1) return;
  B.page = page; refresh();
}

function refresh() {
  syncHead();
  if (!paintCached()) { setBusy(true); if (!$('board-body')?.children.length) placeholder(); }
  void load();
}

function syncHead() {
  const head = $('board-head'); if (!head) return;
  head.querySelector(':scope > .seg')?.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.board === C.S.board));
  const paid = C.S.board === 'round' || C.S.board === 'all';
  let lv = $('board-levels');
  let tiers = $('board-tiers');
  if (!paid) tiers?.remove();
  if (C.S.board !== 'free') lv?.remove();
  if (C.S.board === 'free' && !lv && levels().length) {
    lv = pillGroupEl(levels().map(({ level, name }) => [level, name]), C.S.boardLevel, pickLevel, { id: 'board-levels', 'aria-label': 'Level' });
    lv.querySelectorAll('button').forEach((b, i) => { b.dataset.level = String(levels()[i].level); });
    head.append(lv);
  }
  if (paid && !$('board-tiers')) {
    tiers = el('div', { class: 'seg', id: 'board-tiers', role: 'group', 'aria-label': 'Shift' }, ...TIERS.map(([id, label, title]) => el('button', { type: 'button', 'data-tier': id, title, onclick: () => pickTier(id) }, label)));
    head.append(tiers);
  }
  lv?.querySelectorAll('button').forEach((b) => { const on = Number(b.dataset.level) === C.S.boardLevel; b.classList.toggle('on', on); b.setAttribute('aria-pressed', String(on)); });
  $('board-tiers')?.querySelectorAll('button').forEach((b) => { const on = b.dataset.tier === C.S.boardTier; b.classList.toggle('on', on); b.setAttribute('aria-pressed', String(on)); });
  paintBlurb();
}

function paintBlurb() {
  const p = $('board-blurb'); if (!p) return;
  const v = B.verifiedOnly ? ', verified' : '';
  const shadow = B.verifiedOnly === false ? ' (recording checks are shown in your profile, not enforced yet)' : '';
  const note = B.sort === 'distance' ? '' : ` Sorted by ${SORT_NOTE[B.sort]}. YOUR PLACE stays the distance rank.`;
  if (C.S.board !== 'round') {
    const name = levelName(C.S.boardLevel);
    p.textContent = (C.S.board === 'all' ? `All finished${v} paid shifts, all time.` : `Finished free rides${name ? ` on ${name}` : ''}, all time – each level its own board. No prizes – bragging rights.`) + note;
    return;
  }
  const ends = C.S.pool?.round.endsAt ?? B.endsAt;
  p.replaceChildren(`Ranked by distance of finished${v} paid shifts${B.verifiedOnly ? '' : shadow}. The top ${B.prizeRanks} share `, el('b', {}, '20%'),
    C.S.pool ? ` of the round’s entries (${sol(C.S.pool.split.top20)} so far)` : '',
    ...(ends ? [' · closes in ', el('b', { class: 'cd', id: 'cd' }, left(ends - C.now()))] : []), note);
}

function placeholder() {
  setBusy(true);
  $('board-body')?.replaceChildren(el('tr', {}, el('td', { colspan: '6', class: 'empty' }, 'Loading the board…')));
}

function paintCached() {
  const hit = cache.get(key()); if (!hit) return false;
  apply(hit); return true;
}

async function load() {
  const k = key(), req = ++B.req;
  if (C.S.board === 'free' && !C.S.tiers) { try { C.S.tiers = await api('tiers', undefined, { report: false }); } catch { /* the level buttons stay hidden; the board still loads */ } if (req !== B.req || C.S.tab !== 'board') return; syncHead(); }
  const q = new URLSearchParams({ board: C.S.board, sort: B.sort, page: String(B.page), me: '1' });
  if (C.S.board === 'free') q.set('level', String(C.S.boardLevel)); else q.set('tier', C.S.boardTier);
  let j; try { j = await api(`leaderboard?${q}`, undefined, { report: false }); } catch (e) { if (req !== B.req || C.S.tab !== 'board') return; B.failed = true; setBusy(false); if (!cache.has(k)) $('board-body')?.replaceChildren(el('tr', {}, el('td', { colspan: '6', class: 'bad' }, e.message))); return; }
  if (req !== B.req || C.S.tab !== 'board') return;
  cache.set(k, j); apply(j); C.track('leaderboard_filtered', { board: C.S.board });
}

function apply(j) {
  B.verifiedOnly = j.verifiedOnly; B.prizeRanks = j.prizeRanks; B.endsAt = j.round?.endsAt ?? B.endsAt; B.failed = false;
  syncHead();
  if (j.rows) seedSnsBatch(j.rows);
  if (j.me) seedSns(j.me.wallet, j.me.sns);
  const sig = JSON.stringify([j.board, j.level, j.sort, j.page, j.total, j.rows, j.me, j.standing, j.verifiedOnly]);
  if (B.shown === sig && $('board-body')?.children.length) { setBusy(false); return; }
  B.shown = sig;
  paintStanding(j); paintTable(j); paintPager(j); setBusy(false);
}

function paintStanding(j) {
  const box = $('board-standing'); if (!box) return;
  if (!j.standing) { box.hidden = true; box.replaceChildren(); return; }
  box.hidden = false;
  const rows = j.standing.filter((s) => s.board !== 'all');   // all-time places stay out while that board is off; this round's 1H / 4H / 8H stay
  const both = rows.some((s) => s.board === 'round') && rows.some((s) => s.board === 'all');
  const label = (s) => {
    if (s.board === 'free') return levelName(s.level);
    const tier = TIERS.find(([id]) => id === s.tier)?.[1] ?? s.tier;
    return both ? `${s.board === 'round' ? 'ROUND' : 'ALL'} ${tier}` : tier;
  };
  box.replaceChildren(el('span', { class: 'lbl' }, 'YOUR PLACE'), ...rows.map((s) => el('span', {},
    label(s), ' ', el('b', { class: s.rank == null ? 'dim' : '' }, s.rank == null ? '–' : `#${s.rank}`))));
}

function paintTable(j) {
  const cols = $('board-cols'), body = $('board-body'); if (!cols || !body) return;
  const prize = j.board === 'round' && j.sort === 'distance';   // the amber bar is the prize cut, and only the distance order is that cut
  const you = C.S.me.wallet;
  cols.replaceChildren(el('tr', {}, el('th', {}, '#'), el('th', {}, 'RIDER'), ...COLS.map(([id, label, title]) => el('th', { class: 'r', 'aria-sort': j.sort === id ? 'descending' : 'none' },
    el('button', { type: 'button', class: j.sort === id ? 'on' : '', title, onclick: () => pickSort(id) }, label)))));
  const lines = j.rows.map((r) => line(r, you, prize, false));
  if (j.me && !j.rows.some((r) => r.wallet === you)) lines.push(line({ ...j.me, wallet: you, sns: C.S.me?.sns }, you, prize, true));
  body.replaceChildren(...(lines.length ? lines : [el('tr', {}, el('td', { colspan: '6', class: 'empty' }, 'Nobody has finished a shift here yet.'))]));
}

function line(r, you, prize, pin) {
  const mine = r.wallet === you;
  const medal = r.rank === 1 ? ' g' : r.rank === 2 ? ' s' : r.rank === 3 ? ' b' : '';
  return el('tr', { class: `${prize && r.rank <= B.prizeRanks ? 'prize ' : ''}${mine ? 'me ' : ''}${pin ? 'cut' : ''}` },
    el('td', {}, el('span', { class: `rk${medal}` }, r.rank)),
    el('td', {}, C.avatar(r.wallet), ' ', formatDriver(r.wallet, r.sns), mine ? ' (you)' : ''),
    el('td', { class: 'r' }, C.km(r.distance)), el('td', { class: 'r' }, C.dur(r.seconds)),
    el('td', { class: 'r' }, r.hull == null ? '–' : `${r.hull}%`), el('td', { class: 'r' }, r.rides));
}

function paintPager(j) {
  const box = $('board-pager'); if (!box) return;
  const pages = Math.ceil(j.total / j.pageSize);
  if (pages <= 1) { box.hidden = true; box.replaceChildren(); return; }
  const from = (j.page - 1) * j.pageSize + 1, to = Math.min(j.page * j.pageSize, j.total);
  const btn = (label, page, on, disabled) => el('button', { type: 'button', class: on ? 'on' : '', disabled: disabled || undefined, onclick: () => goPage(page) }, label);
  box.hidden = false;
  box.replaceChildren(btn('PREV', j.page - 1, false, j.page <= 1), ...Array.from({ length: pages }, (_, i) => btn(String(i + 1), i + 1, i + 1 === j.page, false)), btn('NEXT', j.page + 1, false, j.page >= pages), el('span', { class: 'dim' }, `${from}–${to} of ${j.total}`));
}

