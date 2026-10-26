import { store } from '../js/util.js';
import { campaignText } from './campaign-copy.js';
import { el } from './dom.js';
import { campaignSteps, telegramUrl, xPostId } from './campaign.js';

let widgetCounter = 0;
let turnstileScript;
function loadTurnstile() {
  if (window.turnstile) return Promise.resolve(window.turnstile);
  if (!turnstileScript) turnstileScript = new Promise((resolve, reject) => {
    const script = el('script', { src: 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit', async: true });
    script.onload = () => resolve(window.turnstile);
    script.onerror = () => { turnstileScript = null; reject(new Error('Verification widget could not load. Refresh and try again.')); };
    document.head.append(script);
  });
  return turnstileScript;
}

/** Real provider widgets only sign ownership/challenges; the API remains authoritative for every task. */
export function campaignSection({ api, alive = () => true }) {
  let language = store.get('freightchain.campaignLanguage', navigator.language?.startsWith('ru') ? 'ru' : 'en');
  const t = text => campaignText(language, text);
  const heading = el('h2', { id: 'campaign' });
  const box = el('div', { class: 'card', id: 'campaign-box' }, t("Loading campaign…"));
  const note = el('p', { role: 'status', class: 'msg dim', id: 'campaign-msg' });
  let lastMessage = '';
  const say = (message, bad = false) => { lastMessage = message; if (alive()) { note.textContent = t(message); note.className = `msg ${bad ? 'bad' : 'dim'}`; } };
  let row, busy = false, challenge = '', widgetId, widgetGeneration = 0;
  let handleValue = '', postValue = '', rulesAccepted = false;
  const authName = `fcCampaignTelegram${++widgetCounter}`;
  const external = (href, text) => href ? el('a', { href, target: '_blank', rel: 'noopener noreferrer' }, text) : '';

  const submit = async (path, body) => {
    if (busy || !alive()) return;
    if (row.turnstile.required && !challenge) { say(t("Complete the verification challenge first."), true); return; }
    busy = true;
    const token = challenge;
    paint();
    try {
      row = await api(path, { ...body, ...(token ? { turnstileToken: token } : {}) }, { report: false });
      say(t("Progress saved."));
    } catch (e) { say(e.message, true); }
    busy = false;
    challenge = '';
    if (alive()) paint();
  };
  window[authName] = proof => {
    if (alive()) submit('airdrop/verify-telegram', { telegramUserId: String(proof.id), proof });
    else delete window[authName];
  };

  const paint = () => {
    if (!alive()) return;
    const generation = ++widgetGeneration;
    if (widgetId != null && window.turnstile) { window.turnstile.remove(widgetId); widgetId = undefined; }
    challenge = '';
    heading.textContent = t('CAMPAIGN');
    note.textContent = t(lastMessage);
    box.lang = language;
    const steps = campaignSteps(row);
    const tg = el('div', { id: 'campaign-telegram' });
    const challengeBox = el('div', { id: 'campaign-challenge' });
    const enabled = row.rideUnlocked && !busy;
    const handle = el('input', { id: 'campaign-x-handle', 'aria-label': t("X handle"), placeholder: t("X handle"), maxlength: 16, value: handleValue, disabled: !enabled, oninput: e => { handleValue = e.target.value; } });
    const post = el('input', { id: 'campaign-x-post', 'aria-label': t("X post URL or ID"), placeholder: t("Post URL or ID"), maxlength: 256, value: postValue, disabled: !enabled, oninput: e => { postValue = e.target.value; } });
    const accept = el('input', { type: 'checkbox', id: 'campaign-rules', checked: rulesAccepted, disabled: busy, onchange: e => { rulesAccepted = e.target.checked; } });
    box.replaceChildren(
      el('button', { type: 'button', class: 'ghost', id: 'campaign-language', 'aria-label': 'Campaign language: English / Русский', onclick: () => { language = language === 'ru' ? 'en' : 'ru'; store.set('freightchain.campaignLanguage', language); paint(); } }, language === 'ru' ? 'ENGLISH' : 'РУССКИЙ'),
      el('p', {}, `${row.completedTasks} ${t('of 3 task categories completed. Evidence carries into Season 1; the points allocation is pending. No TEN4 is minted or claimable here.')}`),
      el('ol', {}, steps.map(([label, done]) => el('li', { class: done ? 'good' : 'dim' }, `${done ? '✓' : '○'} ${t(label)}`))),
      el('p', {}, t("Personal X code: "), el('code', { id: 'campaign-code', style: 'overflow-wrap:anywhere' }, row.code)),
      el('p', { class: 'dim' }, t("X requires an account at least 90 days old with at least 10 followers. Include your complete personal code and @FreightChainSol in the post.")),
      el('p', {}, external(telegramUrl(row.telegram.channel), t("Official Telegram channel")), ' · ', external(telegramUrl(row.telegram.group), t("Official Telegram group")), ' · ', external('https://x.com/FreightChainSol', t("Official X account"))),
      tg,
      el('p', { class: 'dim' }, t("After linking, introduce yourself in the group with at least three words and 20 characters. Forwarded posts, links and bot commands do not count. Then refresh progress.")),
      el('div', { class: 'campaign-form' }, handle, post, el('button', { type: 'button', id: 'campaign-verify-x', disabled: !enabled, onclick: () => {
        const postId = xPostId(postValue);
        if (!postId || !/^@?[A-Za-z0-9_]{1,15}$/.test(handleValue.trim())) { say(t("Enter your X handle and a valid X post URL or ID."), true); return; }
        submit('airdrop/verify-x', { handle: handleValue.trim(), postId });
      } }, t("VERIFY X"))),
      row.turnstile.required ? challengeBox : '',
      row.event.enabled ? el('div', {},
        el('p', {}, `${t('One ranked 1h event attempt. Starts:')} ${row.event.startsAt ?? t('not scheduled')}; ${t('last start:')} ${row.event.lastStartAt ?? t('not scheduled')}.`),
        el('p', { class: 'dim' }, t("One person, one attempt. The attempt is consumed when you order its ride. Only verified, eligible rides may qualify; there is no guaranteed prize. Free training remains available.")),
        el('label', { class: 'opt' }, accept, t(" I am 18 or older and accept these event rules.")),
        el('button', { type: 'button', id: 'campaign-attempt', disabled: busy || row.event.attemptGranted || !row.tasksComplete || !row.telegram.active, onclick: () => {
          if (!rulesAccepted) { say(t("Accept the event rules first."), true); return; }
          submit('airdrop/preseason/claim-attempt', { acceptedRules: true });
        } }, row.event.attemptGranted ? t("ATTEMPT ISSUED — OPEN NEW RIDE") : t("CLAIM ONE EVENT ATTEMPT"))) : el('p', { class: 'dim' }, t("Event attempts are not open. Your campaign progress is saved.")),
      el('button', { type: 'button', id: 'campaign-refresh', class: 'ghost', disabled: busy, onclick: load }, t("REFRESH PROGRESS")));
    if (row.telegram.bound && row.telegram.member && row.telegram.groupMember) tg.append(el('p', { class: 'good' }, t('Telegram membership verified.')));
    else if (enabled && row.telegram.loginBot) {
      tg.append(el('script', { src: 'https://telegram.org/js/telegram-widget.js?22', async: true, 'data-telegram-login': row.telegram.loginBot, 'data-size': 'large', 'data-onauth': `${authName}(user)` }));
    } else tg.append(el('p', { class: 'dim' }, !row.rideUnlocked ? t("Finish a verified MEDIUM or HARD ride to unlock social verification.") : t("Telegram login is not configured yet. Your progress remains saved.")));
    if (!busy && row.turnstile.required) {
      if (!row.turnstile.siteKey) { challengeBox.textContent = t("Verification is not configured yet. Please try again later."); return; }
      loadTurnstile().then(widget => {
        if (!alive() || generation !== widgetGeneration) return;
        widgetId = widget.render(challengeBox, { sitekey: row.turnstile.siteKey, action: 'preseason', callback: token => { challenge = token; }, 'expired-callback': () => { challenge = ''; } });
      }).catch(e => say(e.message, true));
    }
  };
  const load = async () => {
    if (busy) return;
    busy = true;
    try { row = await api('airdrop/status', undefined, { report: false }); if (alive()) { busy = false; paint(); } }
    catch (e) { busy = false; if (alive()) box.replaceChildren(el('p', { class: 'bad' }, `${t('Campaign unavailable:')} ${t(e.message)}`), el('button', { type: 'button', onclick: load }, t("RETRY"))); }
  };
  load();
  return [heading, box, note];
}
