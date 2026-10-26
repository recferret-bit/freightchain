import en from '../../../docs/legal/PRESEASON_RULES.md?raw';
import ru from '../../../docs/legal/PRESEASON_RULES_RU.md?raw';
import './legal.css';

// The repository documents remain verbatim, including every draft label and unfilled publication detail.
const names = { en: ['Pre-season terms', 'Pre-season privacy notice', 'Pre-season rules'], ru: ['Условия Pre-season', 'Конфиденциальность Pre-season', 'Правила Pre-season'] };
const paths = ['terms', 'privacy', 'rules'];
// Same keys and precedence as client/site/i18n.js, kept local: importing it would ship the whole lobby dictionary to a static text page.
const KEYS = ['fc_lang', 'freightchain.lang'];
const valid = v => v === 'ru' || v === 'en';
const read = key => { try { return localStorage.getItem(key); } catch { return null; } };
const saveLang = lang => { for (const key of KEYS) { try { localStorage.setItem(key, lang); } catch { /* storage blocked */ } } };
function currentLang() {
  const query = new URL(location.href).searchParams.get('lang');
  if (valid(query)) { saveLang(query); return query; }
  return [read(KEYS[0]), read(KEYS[1])].find(valid) ?? (String(navigator.language || '').toLowerCase().startsWith('ru') ? 'ru' : 'en');
}
const page = paths.findIndex(path => location.pathname.split('/').includes(path));
function render() {
  const lang = currentLang(); document.documentElement.lang = lang;
  document.getElementById('legal-title').textContent = names[lang][Math.max(0, page)];
  document.getElementById('legal-draft').textContent = lang === 'ru' ? 'Черновик для локальной проверки devnet. Сведения об организаторе и публикации ещё не заполнены. Полный текст правил и уведомления приведён ниже без изменений.' : 'Draft for local devnet review. Organizer and publication details remain unfilled. The complete rules and privacy notice are reproduced unchanged below.';
  document.getElementById('legal-text').textContent = lang === 'ru' ? ru : en;
  document.getElementById('legal-home').href = `/`;
  const links = document.getElementById('legal-links'); links.replaceChildren();
  for (const [i, path] of paths.entries()) { const a = document.createElement('a'); a.href = `/${path}/?lang=${lang}`; a.textContent = names[lang][i]; links.append(a, ' · '); }
}
for (const button of document.querySelectorAll('[data-lang]')) button.onclick = () => {
  const lang = button.dataset.lang; saveLang(lang);
  const url = new URL(location.href); url.searchParams.set('lang', lang); history.replaceState(null, '', url); render();
};
render();
