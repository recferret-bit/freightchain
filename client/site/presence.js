/* One random id per browser for "who is online" – sent with the pages' own polls (/api/live from the landing and the lobby, /api/watch from the watch
   page); the server counts distinct ids per address for ~30 s. Not personal data, not a login: clearing site data makes a new one. */
const KEY = 'freightchain.viewer';
let id = null;
export function visitorId() {
  if (id) return id;
  try { id = localStorage.getItem(KEY); } catch { /* storage blocked */ }
  if (!id || !/^[A-Za-z0-9_-]{8,64}$/.test(id)) {
    id = Math.random().toString(36).slice(2, 12) + Date.now().toString(36);
    try { localStorage.setItem(KEY, id); } catch { /* fine: this tab keeps it */ }
  }
  return id;
}
/** the /api/live path with this page counted online */
export const livePath = page => `live?visitor=${encodeURIComponent(visitorId())}&page=${page}`;
