/* Consent never signs a transaction or retries an interrupted purchase. The server owns accepted versions. */
import { el } from './dom.js';
import { currentLang, t, saveLang, applyI18n } from './i18n.js';
import { SITE_BASE } from '../js/hosts.js';

let pending = null;
const text = (tag, key, attrs = {}) => el(tag, { ...attrs, 'data-i18n': key }, t(key));

export function reviewTerms(api) {
  if (typeof document === 'undefined') return Promise.resolve(false);
  if (pending) return pending;
  pending = (async () => {
    const status = await api('profile/terms', undefined, { report: false });
    if (!status.required) return true;
    return new Promise(resolve => {
      const dialog = el('dialog', { id: 'terms-dialog', 'aria-labelledby': 'terms-title', style: 'max-width:620px;width:calc(100% - 40px);box-sizing:border-box;max-height:90vh;overflow:auto;background:#181622;color:#f2edf9;border:1px solid #aa7bff;border-radius:12px;padding:24px;font:16px/1.5 system-ui;z-index:10000' });
      const age = el('input', { id: 'terms-age', type: 'checkbox' });
      const accept = text('button', 'consent.accept', { id: 'terms-accept', type: 'button', disabled: true });
      const refuse = text('button', 'consent.decline', { id: 'terms-decline', type: 'button' });
      const note = el('p', { id: 'terms-status', role: 'status' });
      const link = (path, key) => text('a', key, { href: `${SITE_BASE}/${path}/?lang=${currentLang()}`, target: '_blank', rel: 'noopener', style: 'color:#c9adff' });
      const rules = link('terms', 'consent.rules'), privacy = link('privacy', 'consent.privacy');
      const lang = el('div', {}, ...['en', 'ru'].map(code => el('button', { type: 'button', 'data-terms-lang': code, onclick: () => {
        saveLang(code);
        const url = new URL(location.href); url.searchParams.set('lang', code); history.replaceState(null, '', url);
        rules.href = `${SITE_BASE}/terms/?lang=${code}`; privacy.href = `${SITE_BASE}/privacy/?lang=${code}`;
        applyI18n(document);
      } }, code.toUpperCase())));
      const finish = ok => { dialog.close(); dialog.remove(); resolve(ok); };
      age.onchange = () => { accept.disabled = !age.checked; };
      refuse.onclick = () => finish(false);
      dialog.addEventListener('cancel', event => { event.preventDefault(); finish(false); });
      accept.onclick = async () => {
        if (!age.checked || accept.disabled) return;
        accept.disabled = refuse.disabled = age.disabled = true; note.textContent = t('consent.saving');
        try {
          await api('profile/terms', { termsVersion: status.termsVersion, privacyVersion: status.privacyVersion, age18: true, accepted: true }, { report: false });
          window.dispatchEvent(new window.CustomEvent('fc:terms-accepted'));
          finish(true);
        } catch { note.textContent = t('consent.error'); accept.disabled = refuse.disabled = age.disabled = false; }
      };
      dialog.append(lang, text('h2', 'consent.title', { id: 'terms-title' }), text('p', 'consent.intro'), text('p', 'consent.draft'), el('p', {}, rules, ' · ', privacy), el('p', { id: 'terms-versions' }, `v${status.termsVersion} / v${status.privacyVersion}`), el('label', { style: 'display:block;margin:20px 0' }, age, ' ', text('span', 'consent.age')), accept, ' ', refuse, note);
      document.body.append(dialog); dialog.showModal(); age.focus();
    });
  })().catch(() => false).finally(() => { pending = null; });
  return pending;
}
