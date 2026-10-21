import { MONO } from '../util.js';
import { button, heading, paintImage, simBar } from '../phone/chrome.js';
import { t } from './i18n/index.js';

/* Screens for a revealed minigame. Pictures come from job.images. Labels are chrome, never the secret. */

const HOST = {
  chat: ['phone-sms'],
  wallet: ['address-check', 'sign-or-reject', 'fuel-rugpull', 'gas-priority'],
  swap: ['buy-shitcoin'],
};

const ROLE = { dispatch: 'sms.role.dispatch', tyres: 'sms.role.tyres', operator: 'sms.role.operator', mom: 'sms.role.mom', distract: 'sms.role.tyres' };
const threadLabel = role => t(ROLE[role] ?? 'sms.thread');

export function hosts(appId, kind) { return !!HOST[appId]?.includes(kind); }

export function smsModel(layout = {}) {
  const raw = Array.isArray(layout.keys) ? layout.keys : ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0'];
  const keys = raw.map(k => String(k).replace(/\D/g, '').slice(-1) || '0');
  const threads = (Array.isArray(layout.threads) ? layout.threads : []).map((th, i) => ({
    id: String(th.id ?? i),
    role: th.role ?? null,
    previewAsset: th.previewAsset ?? th.bubbles?.[0]?.assetId ?? null,
    bodyAsset: th.bubbles?.[0]?.assetId ?? th.bodyAsset ?? th.previewAsset ?? null,
  }));
  const cabRaw = Array.isArray(layout.cabAssets) ? layout.cabAssets : (Array.isArray(layout.cab) ? layout.cab : []);
  const cab = cabRaw.map((c, i) => ({ id: c.assetId ?? c.id, slot: c.slot ?? i })).filter(c => c.id);
  return {
    threads,
    smsAsset: layout.smsAsset ?? layout.body ?? null,
    keys: keys.length === 10 ? keys : ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0'],
    sendSlot: Math.abs(Number(layout.sendSlot) || 0) % 3,
    iconOrder: Array.isArray(layout.iconOrder) && layout.iconOrder.length === 12 ? layout.iconOrder : null,
    cab,
  };
}

const pic = (job, id) => (id ? job.images?.get(id) ?? null : null);
const crypto = kind => kind && kind !== 'phone-sms';

function dots(g, W, draft, y) {
  g.fillStyle = '#f4f7fb'; g.font = `700 22px ${MONO}`; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(draft ? '●'.repeat(Math.min(draft.length, 6)) : '····', W / 2, y);
}

function resultLine(g, W, H, job) {
  if (!job.result) return;
  const text = job.result.outcome === 'correct' ? t('sms.ok') : job.result.final ? t('sms.timeout') : t('sms.wrong', { n: job.result.attemptsLeft ?? 0 });
  g.fillStyle = job.result.outcome === 'correct' ? '#9be7b3' : '#ffb4a8';
  g.font = `700 14px ${MONO}`; g.textAlign = 'center'; g.fillText(text, W / 2, H - 78);
}

export function paintJob(g, W, H, job) {
  g.fillStyle = '#10141b'; g.fillRect(0, 0, W, H);
  if (crypto(job.kind)) simBar(g, W);
  if (job.kind === 'phone-sms') paintSms(g, W, H, job);
  else if (job.kind === 'buy-shitcoin') paintBuy(g, W, H, job);
  else if (job.kind === 'address-check') paintAddress(g, W, H, job);
  else if (job.kind === 'sign-or-reject') paintSign(g, W, H, job);
  else if (job.kind === 'fuel-rugpull') paintFuel(g, W, H, job);
  else if (job.kind === 'gas-priority') paintGas(g, W, H, job);
  resultLine(g, W, H, job);
}

export function paintSeed(g, W, H, job) {
  const L = job.layout ?? {};
  g.fillStyle = '#10141b'; g.fillRect(0, 0, W, H); simBar(g, W);
  if (L.mode === 'phish' || job.variant === 'phish') {
    heading(g, W, 'Rig Wallet', 78);
    paintImage(g, pic(job, L.cardAsset ?? L.phraseAsset), 16, 96, W - 32, 160);
    button(g, 16, H - 150, W - 32, 44, t('pin.enter'), false);
    button(g, 16, H - 96, W - 32, 44, t('pin.refuse'), true);
    return;
  }
  const idx = Array.isArray(L.indexes) ? L.indexes : [3, 7, 11];
  heading(g, W, t('pin.unlock', { a: idx[0], b: idx[1], c: idx[2] }), 78);
  paintImage(g, pic(job, L.noteAsset), 16, 100, W - 32, 80);
  g.fillStyle = '#f4f7fb'; g.font = `600 14px ${MONO}`; g.textAlign = 'center';
  g.fillText(job.draft || '·', W / 2, 210);
  button(g, 16, H - 96, W - 32, 44, t('pin.enter'), true);
}

function imageBox(img, maxW, maxH) {
  const iw = img?.naturalWidth || img?.width || 96;
  const ih = img?.naturalHeight || img?.height || 28;
  let dw = maxW, dh = dw * ih / iw;
  if (dh > maxH) { dh = maxH; dw = dh * iw / ih; }
  return { dw, dh };
}

function paintSms(g, W, H, job) {
  const m = smsModel(job.layout ?? {});
  const ui = job.ui || 'list';
  if (ui === 'keys') {
    heading(g, W, t('sms.reply'), 28);
    dots(g, W, job.draft || '', 78);
    keyGrid(g, W, H, m.keys, m.sendSlot, false);
    return;
  }
  if (ui === 'body') {
    const th = m.threads.find(row => row.id === job.threadId) ?? m.threads[0];
    const img = pic(job, th?.bodyAsset ?? m.smsAsset);
    const box = imageBox(img, W - 36, H * 0.46);
    g.fillStyle = '#c5ced8'; g.font = `600 12px ${MONO}`; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(t('sms.type_these'), W / 2, 22);
    paintImage(g, img, (W - box.dw) / 2, 40, box.dw, box.dh);
    button(g, 16, H - 120, W - 32, 48, t('sms.reply'), true);
    return;
  }
  heading(g, W, t('sms.role.dispatch'), 28);
  g.fillStyle = '#c5ced8'; g.font = `600 12px ${MONO}`; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(t('sms.type_these'), W / 2, 48);
  if (!m.threads.length) { g.fillStyle = '#c5ced8'; g.font = `600 13px ${MONO}`; g.textAlign = 'center'; g.fillText(t('sms.empty'), W / 2, H / 2); return; }
  let y = 64;
  m.threads.forEach(th => {
    const img = pic(job, th.previewAsset);
    const box = imageBox(img, W - 48, 84);
    const rowH = 30 + box.dh;
    g.fillStyle = 'rgba(255,255,255,.06)'; g.beginPath(); g.roundRect(12, y, W - 24, rowH, 12); g.fill();
    g.fillStyle = '#f4f7fb'; g.font = `700 14px ${MONO}`; g.textAlign = 'left'; g.textBaseline = 'middle';
    g.fillText(threadLabel(th.role), 24, y + 16);
    paintImage(g, img, 24, y + 26, box.dw, box.dh);
    y += rowH + 8;
  });
}

function keyGrid(g, W, H, keys, sendSlot, draw) {
  const s = Math.min(64, (W - 48) / 3), gap = 8, x0 = (W - (3 * s + 2 * gap)) / 2, y0 = 110;
  keys.forEach((d, i) => {
    const c = i % 3, r = Math.floor(i / 3);
    if (i === 9) button(g, x0 + s + gap, y0 + 3 * (s * .72 + gap), s, s * .72, d, false);
    else button(g, x0 + c * (s + gap), y0 + r * (s * .72 + gap), s, s * .72, d, false);
  });
  const y = H - 70, w = (W - 40) / 3, slots = [t('sms.send'), '⌫', t('sms.send')];
  for (let i = 0; i < 3; i++) button(g, 12 + i * (w + 8), y, w, 44, i === sendSlot ? t('sms.send') : (i === (sendSlot + 1) % 3 ? '⌫' : ''), i === sendSlot);
  void slots; void draw;
}

function paintBuy(g, W, H, job) {
  const rows = job.layout?.rows ?? [];
  heading(g, W, t('app.swap'), 72);
  paintImage(g, pic(job, job.layout?.taskAsset), 12, 88, W - 24, 70);
  if (job.ui === 'amount' && job.rowId) {
    dots(g, W, job.amount || '', 190);
    button(g, 16, H - 150, W - 32, 44, t('buy.buy'), true);
    button(g, 16, H - 96, W - 32, 44, t('buy.decline'), false);
    return;
  }
  rows.forEach((row, i) => { paintImage(g, pic(job, row.asset), 12, 170 + i * 48, W - 24, 42); });
  button(g, 16, H - 64, W - 32, 44, t('buy.decline'), false);
}

function paintAddress(g, W, H, job) {
  const opts = job.layout?.options ?? [];
  heading(g, W, t('app.wallet'), 72);
  paintImage(g, pic(job, job.layout?.taskAsset), 12, 88, W - 24, 64);
  g.fillStyle = '#c5ced8'; g.font = `600 11px ${MONO}`; g.textAlign = 'left'; g.fillText(t('addr.pasted'), 16, 168);
  paintImage(g, pic(job, job.layout?.pastedAsset), 12, 176, W - 24, 36);
  opts.forEach((o, i) => { paintImage(g, pic(job, o.asset), 12, 224 + i * 48, W - 24, 42); });
  button(g, 16, H - 64, W - 32, 44, t('addr.cancel'), false);
}

function paintSign(g, W, H, job) {
  heading(g, W, t('app.wallet'), 72);
  paintImage(g, pic(job, job.layout?.cardAsset), 12, 96, W - 24, H * .4);
  button(g, 16, H - 150, (W - 40) / 2, 48, t('sign.reject'), false);
  button(g, 24 + (W - 40) / 2, H - 150, (W - 40) / 2, 48, t('sign.sign'), true);
  if (job.layout?.signFirst) { /* positions come from the server when it sends signSlot; default reject left */ }
}

function paintFuel(g, W, H, job) {
  const frames = job.layout?.frames ?? [];
  const elapsed = performance.now() - (job.shownAt || 0);
  let frame = frames[0];
  for (const f of frames) if ((f.atMs ?? 0) <= elapsed) frame = f;
  heading(g, W, t('fuel.pay'), 72);
  paintImage(g, pic(job, job.layout?.limitAsset), 12, 96, W - 24, 48);
  paintImage(g, pic(job, frame?.id), 12, 156, W - 24, 80);
  job.frameId = frame?.id ?? null;
  button(g, 16, H - 150, W - 32, 44, t('fuel.pay'), true);
  button(g, 16, H - 96, W - 32, 44, t('fuel.cancel'), false);
}

function paintGas(g, W, H, job) {
  const opts = job.layout?.options ?? [];
  heading(g, W, t('gas.title'), 72);
  paintImage(g, pic(job, job.layout?.tableAsset), 12, 96, W - 24, 120);
  paintImage(g, pic(job, job.layout?.queueAsset), 12, 224, W - 24, 36);
  opts.forEach((o, i) => button(g, 16, 276 + i * 52, W - 32, 44, String(i + 1), false));
}

export function hitsJob(W, H, job) {
  const hits = [];
  const add = (id, x, y, w, h) => hits.push({ id, x, y, w, h });
  if (job.kind === 'phone-sms') {
    const m = smsModel(job.layout ?? {}), ui = job.ui || 'list';
    if (ui === 'list') m.threads.forEach((th, i) => add('mg:thread:' + (th.id ?? i), 12, 56 + i * 78, W - 24, 70));
    else if (ui === 'body') add('mg:reply', 16, H - 120, W - 32, 48);
    else {
      const s = Math.min(64, (W - 48) / 3), gap = 8, x0 = (W - (3 * s + 2 * gap)) / 2, y0 = 110;
      m.keys.forEach((d, i) => {
        if (i === 9) add('mg:key:' + d, x0 + s + gap, y0 + 3 * (s * .72 + gap), s, s * .72);
        else add('mg:key:' + d, x0 + (i % 3) * (s + gap), y0 + Math.floor(i / 3) * (s * .72 + gap), s, s * .72);
      });
      const w = (W - 40) / 3;
      for (let i = 0; i < 3; i++) {
        const id = i === m.sendSlot ? 'mg:send' : i === (m.sendSlot + 1) % 3 ? 'mg:bksp' : null;
        if (id) add(id, 12 + i * (w + 8), H - 70, w, 44);
      }
    }
  } else if (job.kind === 'buy-shitcoin') {
    if (job.ui === 'amount') { add('mg:buy', 16, H - 150, W - 32, 44); add('mg:decline', 16, H - 96, W - 32, 44); }
    else { (job.layout?.rows ?? []).forEach((row, i) => add('mg:row:' + row.id, 12, 170 + i * 48, W - 24, 42)); add('mg:decline', 16, H - 64, W - 32, 44); }
  } else if (job.kind === 'address-check') {
    (job.layout?.options ?? []).forEach((o, i) => add('mg:opt:' + o.id, 12, 224 + i * 48, W - 24, 42));
    add('mg:refuse', 16, H - 64, W - 32, 44);
  } else if (job.kind === 'sign-or-reject') {
    add('mg:refuse', 16, H - 150, (W - 40) / 2, 48);
    add('mg:sign', 24 + (W - 40) / 2, H - 150, (W - 40) / 2, 48);
  } else if (job.kind === 'fuel-rugpull') {
    add('mg:pay', 16, H - 150, W - 32, 44);
    add('mg:refuse', 16, H - 96, W - 32, 44);
  } else if (job.kind === 'gas-priority') {
    (job.layout?.options ?? []).forEach((o, i) => add('mg:opt:' + o.id, 16, 276 + i * 52, W - 32, 44));
  }
  return hits;
}

export function hitsSeed(W, H, job) {
  const phish = (job.layout?.mode ?? job.variant) === 'phish';
  if (phish) return [{ id: 'mg:words', x: 16, y: H - 150, w: W - 32, h: 44 }, { id: 'mg:refuse', x: 16, y: H - 96, w: W - 32, h: 44 }];
  return [{ id: 'mg:words', x: 16, y: H - 96, w: W - 32, h: 44 }];
}

/** Returns an answer object when the press finishes the attempt, or null when it only moves the screen. */
export function pressJob(id, job) {
  if (id.startsWith('mg:thread:')) { job.threadId = id.slice(10); job.ui = 'body'; return null; }
  if (id === 'mg:reply') { job.ui = 'keys'; job.draft = ''; return null; }
  if (id.startsWith('mg:key:')) { job.draft = ((job.draft || '') + id.slice(7)).slice(0, 6); return null; }
  if (id === 'mg:bksp') { job.draft = (job.draft || '').slice(0, -1); return null; }
  if (id === 'mg:send') return { type: 'code', value: job.draft || '' };
  if (id.startsWith('mg:row:')) { job.rowId = id.slice(7); job.ui = 'amount'; job.amount = ''; return null; }
  if (id === 'mg:buy') return { type: 'buy', rowId: job.rowId, amount: Number(job.amount || 0) };
  if (id === 'mg:decline' || id === 'mg:refuse') return { type: 'refuse' };
  if (id === 'mg:sign') return { type: 'sign' };
  if (id.startsWith('mg:opt:')) return { type: 'choice', optionId: id.slice(7) };
  if (id === 'mg:pay') return { type: 'pay', frameId: job.frameId };
  if (id === 'mg:words') return { type: 'words', words: (job.draft || '').trim().split(/\s+/).slice(0, 3) };
  return null;
}

export function keyJob(e, job) {
  if (e.repeat) return false;
  if (job.kind === 'phone-sms' && job.ui === 'keys') {
    if (/^Digit[0-9]$/.test(e.code)) { job.draft = ((job.draft || '') + e.code.slice(5)).slice(0, 6); return true; }
    if (e.code === 'Backspace') { job.draft = (job.draft || '').slice(0, -1); return true; }
    if (e.code === 'Enter') return 'submit';
  }
  if (job.kind === 'buy-shitcoin' && job.ui === 'amount' && /^Digit[0-9]$/.test(e.code)) {
    job.amount = ((job.amount || '') + e.code.slice(5)).slice(0, 6); return true;
  }
  if (job.kind === 'seed-words' && /^Key[A-Z]$/.test(e.code) && !e.ctrlKey && !e.metaKey) {
    job.draft = (job.draft || '') + e.key.toLocaleLowerCase(); return true;
  }
  if (e.code === 'Backspace' && job.kind === 'seed-words') { job.draft = (job.draft || '').slice(0, -1); return true; }
  if (e.code === 'Space' && job.kind === 'seed-words') { job.draft = (job.draft || '') + ' '; return true; }
  return false;
}
