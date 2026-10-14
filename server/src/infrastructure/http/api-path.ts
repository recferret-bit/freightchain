/**
 * The path as Express ROUTES it: case-insensitively and with a trailing slash ignored (no 'case sensitive routing' / 'strict routing'). Every predicate that
 * picks a path out – the stricter rate limits, the request log, the CORS and beacon exceptions – compares THIS, or /API/AUTH/verify and /api/promo/redeem/
 * reach the same handler past it (pentest M9). Query strings are not part of it.
 */
export const apiPath = (path: string): string => (path.split('?')[0] ?? '').toLowerCase().replace(/\/+$/, '') || '/';
