import en from '../../../docs/legal/PRESEASON_RULES.md?raw';
import './legal.css';

// The repository documents remain verbatim, including every draft label and unfilled publication detail.
const names = ['Pre-season terms', 'Pre-season privacy notice', 'Pre-season rules'];
const paths = ['terms', 'privacy', 'rules'];
const page = paths.findIndex(path => location.pathname.split('/').includes(path));
document.documentElement.lang = 'en';
document.getElementById('legal-title').textContent = names[Math.max(0, page)];
document.getElementById('legal-draft').textContent = 'Draft for local devnet review. Organizer and publication details remain unfilled. The complete rules and privacy notice are reproduced unchanged below.';
document.getElementById('legal-text').textContent = en;
document.getElementById('legal-home').href = `/`;
const links = document.getElementById('legal-links'); links.replaceChildren();
for (const [i, path] of paths.entries()) { const a = document.createElement('a'); a.href = `/${path}/`; a.textContent = names[i]; links.append(a, ' · '); }
