import { st } from '../state.js';
import { audio } from '../sim/audio.js';
import { online } from '../online.js';
import { track } from '../analytics.js';
import { SITE_BASE } from '../hosts.js';
import { onShift, transitionRideMode, RIDE_MODES } from './ride-fsm.js';
import { syncHonk } from './honk-hud.js';

/* Walk-off / bail confirmation modal, pause panel, and top-right corner navigation component. */

export const BAIL_BTN = {
  yard: { id: 'bail-yard', name: 'I MISS THE YARD', tip: 'lobby' },
  done: { id: 'bail-done', name: "I'M DONE", tip: 'landing' },
};

export const bailBtn = kind => {
  const b = BAIL_BTN[kind];
  return `<button type="button" class="alt bail-link" id="${b.id}" title="${b.tip}"><b>${b.name}</b><small>${b.tip}</small></button>`;
};

const ticketNote = () => online.ride ? ' A ticket you spent stays spent.' : '';
const LEAVE = {
  yard: {
    h1: 'I MISS THE YARD',
    h2: 'The lobby. The plastic chairs. Other people\'s trucks.',
    href: () => `${SITE_BASE}/lobby.html`,
    ask: () => onShift() ? (st.complete ? 'End the finished shift and go back to the lobby?' : `Leave for the lobby? This shift ends abandoned.${ticketNote()}`) : 'Back to the lobby?',
  },
  done: {
    h1: "I'M DONE",
    h2: 'The front page. The brochure. No wheel in your hands.',
    href: () => `${SITE_BASE}/`,
    ask: () => onShift() ? (st.complete ? 'End the finished shift and go back to the front page?' : `Leave for the front page? This shift ends abandoned.${ticketNote()}`) : 'Back to the front page?',
  },
};

export function createBailController({ overlay, panel, getMenuArgs, showMenu, setPaused, endShift }) {
  let askBack = 'menu', leaving = false, bail = null;

  function syncBail() {
    if (bail) bail.hidden = !!st.watch || st.mode !== 'drive' || !overlay.classList.contains?.('hide');
    syncHonk();
  }

  function bindBail() {
    const wire = (id, kind) => { const el = document.getElementById(id); if (el) el.onclick = () => askLeave(kind); };
    wire('bail-yard', 'yard'); wire('bail-done', 'done');
  }

  function paintPause() {
    panel.innerHTML = `<h1>PAUSED</h1><h2>Time does not accrue while paused. The road never ends.</h2>
      <div class="btns"><button class="stay" id="resume">RESUME</button><button class="alt" id="endshift" hidden>${st.complete ? 'END SHIFT (complete)' : 'ABANDON SHIFT'}</button></div>
      <h2 class="walkoff">Walk off, if you mean it.</h2>
      <div class="btns">${bailBtn('yard')}${bailBtn('done')}</div>`;
    overlay.classList.remove('hide');
    document.getElementById('resume').onclick = () => setPaused(false);
    document.getElementById('endshift').onclick = () => endShift();
    bindBail(); syncBail();
  }

  function holdShift() {
    if (st.mode !== 'drive' || st.watch) return;
    transitionRideMode(RIDE_MODES.PAUSED); overlay.classList.remove('hide');
    if (online.ride) track('ride_paused', { via: 'bail' });
    syncBail();
  }

  function askLeave(kind) {
    if (st.watch || !LEAVE[kind]) return;
    const fromDrive = st.mode === 'drive';
    if (fromDrive) holdShift();
    askBack = fromDrive ? 'drive' : st.mode === 'paused' ? 'pause' : 'menu';
    const L = LEAVE[kind];
    panel.innerHTML = `<h1>${L.h1}</h1><h2>${L.h2}</h2><div class="ask">${L.ask()}</div><div class="btns"><button type="button" class="stay" id="bail-no">I'M STAYING</button><button type="button" class="alt" id="bail-yes">YES</button></div>`;
    overlay.classList.remove('hide'); audio.play('ui');
    document.getElementById('bail-no').onclick = cancelLeave;
    document.getElementById('bail-yes').onclick = () => goLeave(kind);
    syncBail();
  }

  function cancelLeave() {
    if (askBack === 'drive') setPaused(false, 'bail');
    else if (askBack === 'pause') paintPause();
    else showMenu(...getMenuArgs());
  }

  async function goLeave(kind) {
    if (leaving) return;
    leaving = true;
    const href = LEAVE[kind].href?.() || '';
    try {
      if (onShift()) await endShift(!!href);
      if (href) location.href = href;
    } finally { leaving = false; }
  }

  function mountCorner() {
    if (typeof document === 'undefined' || !document.body?.append) return null;
    const nav = document.createElement('nav');
    nav.id = 'bail'; nav.hidden = true; nav.setAttribute?.('aria-label', 'Leave the shift');
    for (const [kind, spec] of Object.entries(BAIL_BTN)) {
      const b = document.createElement('button');
      b.type = 'button'; b.id = `corner-${kind}`; b.title = spec.tip;
      const name = document.createElement('b'); name.textContent = spec.name;
      const tip = document.createElement('small'); tip.textContent = spec.tip;
      b.append(name, tip);
      b.addEventListener('click', () => askLeave(kind));
      nav.append(b);
    }
    document.body.append(nav);
    return nav;
  }

  bail = mountCorner();
  return { bindBail, paintPause, syncBail };
}
