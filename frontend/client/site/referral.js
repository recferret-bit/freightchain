/* Referral code capture and the share link. The server owns bind, capacity and the gift (POST /api/referrals/bind, GET /api/referrals).
   A code is 8 letters or digits. The server skips ambiguous glyphs when it mints one; the client only checks length and alphabet, so a real code is never dropped here. */
import { siteOrigin } from '../js/ui/share.js';

export const REF_KEY = 'freightchain.ref';
const REF_CODE = /^[A-Z0-9]{8}$/;

export const GIFT_ITEMS = ['convoy', 'signal', 'amber'];

export function refCode(raw) {
  const code = String(raw ?? '').trim().toUpperCase();
  return REF_CODE.test(code) ? code : null;
}

export function refFromSearch(search) {
  const params = new URLSearchParams(String(search ?? '').replace(/^\?/, ''));
  return refCode(params.get('ref'));
}

/** Latest valid `?ref=` wins. Anything else leaves storage alone. Returns the code written, or null. */
export function captureRef(storage, search) {
  const code = refFromSearch(search);
  if (code) storage.set(REF_KEY, code);
  return code;
}

/** `null` when the query has no `ref` (the caller should not touch the address bar). `''` when `ref` was the only param. */
export function searchWithoutRef(search) {
  const params = new URLSearchParams(String(search ?? '').replace(/^\?/, ''));
  if (!params.has('ref')) return null;
  params.delete('ref');
  const q = params.toString();
  return q ? `?${q}` : '';
}

/** Landing origin + `?ref=CODE`. `base` is SITE_BASE ('' on one origin); `origin` is the page origin. */
export function shareUrl(base, origin, code) {
  return `${siteOrigin(base, origin)}/?ref=${encodeURIComponent(code)}`;
}

const whole = n => (typeof n === 'number' && Number.isInteger(n) ? n : null);

export function capacityText(r) {
  const used = whole(r?.used), cap = whole(r?.capacity);
  return used == null || cap == null ? '–' : `${used} / ${cap}`;
}

export function availableText(r) {
  const n = whole(r?.available);
  return n == null ? '–' : String(n);
}

export function inviteLabel(status) {
  return status === 'pending' || status === 'active' || status === 'qualified' || status === 'expired' ? status : '–';
}

/** Clear the stored code on success and on 400/409 (already bound, expired, or their own code). Any other failure stays, so the next signed-in load can try once more. */
export async function bindStoredRef(api, storage) {
  const code = refCode(storage.get(REF_KEY));
  if (!code) {
    if (storage.get(REF_KEY)) storage.remove(REF_KEY);   // not a code: posting it would 400 forever
    return 'skip';
  }
  try {
    await api('referrals/bind', { code }, { report: false, timeoutMs: 4000 });
    storage.remove(REF_KEY);
    return 'bound';
  } catch (e) {
    if (e?.status === 409 || e?.status === 400) { storage.remove(REF_KEY); return 'conflict'; }
    return 'keep';
  }
}
