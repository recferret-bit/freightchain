import { getTheme } from '../themes/index.js';
import { applyTheme, env } from './environment.js';
import { roads } from '../net/orchestrator.js';
import { setLivery } from './trailer.js';
import { weather } from '../state.js';

/* Route selection: applies a theme to the scene, hands its bend style + road-pattern weights to the road orchestrator (which regenerates the layout), re-skins the trailer. */
/* The route is NOT the player's to pick: a real ride (online / watch / counted free run) is driven on the route the SERVER assigned (RideDto.route); main.js calls lockTheme() for those pages and
   from then on selectTheme() without `assigned` does nothing (no menu cards, nothing remembered in localStorage, nothing on window.__game there). The offline prototype page (tests, tools) stays unlocked.
   A guard rail, not security: the server stores the route on the ride (a free level's country, or worldFor for a paid ride) and ignores what the game says. */
let locked = false;
export const lockTheme = () => { locked = true; };
export function selectTheme(id, assigned = false) {
  if (locked && !assigned) return getTheme(env.theme?.id);
  const t = getTheme(id);
  Object.assign(weather, { ambient: 25, snow: 0 }, t.weather, { grime: t.grime });   // sim/ and the windscreen read the climate from state, not from the scene
  weather.baseAmbient = weather.ambient;   // a later TEN4 clear restores this route ambient, not the snow chill
  applyTheme(t); roads.setTheme(t); setLivery(t.livery);
  return t;
}
