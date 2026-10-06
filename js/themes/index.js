import route66 from './route66/index.js';
import stuart from './stuart/index.js';
import siberia from './siberia/index.js';
import brenner from './brenner/index.js';
import panamerican from './panamerican/index.js';

/* Route registry – the menu lists these in order. A theme is a plain object; see AGENTS.md ("Themes") for the interface.
   Folder per route: sun / sky / road / terrain / mountains / props (+ index.js assembling them). Shared builders live in ./_shared/. */
export const THEMES = [route66, stuart, siberia, brenner, panamerican];
export const DEFAULT_THEME = 'route66';
export const getTheme = id => THEMES.find(t => t.id === id) ?? THEMES[0];
