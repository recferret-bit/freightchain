import { store } from '../util.js';
import { getTheme } from '../themes/index.js';
import { applyTheme } from './environment.js';
import { roads } from '../net/orchestrator.js';
import { setLivery } from './trailer.js';
import { weather } from '../state.js';

/* Route selection: applies a theme to the scene, hands its bend style + road-pattern weights to the road orchestrator (which regenerates the layout), re-skins the trailer. */
const KEY = 'freightchain.route';
export function selectTheme(id, save = true) {
  const t = getTheme(id);
  Object.assign(weather, { ambient: 25, snow: 0 }, t.weather, { grime: t.grime });   // sim/ and the windscreen read the climate from state, not from the scene
  applyTheme(t); roads.setTheme(t); setLivery(t.livery);
  if (save) store.set(KEY, t.id);
  return t;
}
export const savedThemeId = () => store.get(KEY);
